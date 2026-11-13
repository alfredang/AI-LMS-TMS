import { randomUUID } from 'node:crypto';
import { AutomationError, changedFiles, normalizeFiles, publicFiles, restoreMaskedFiles, seal, sourceHash, unseal, validateEditableSource, type ScriptFile } from './model';
import type { ScriptGateway } from './google';
import type { AutomationStore } from './store';

type DraftSource = { before: ScriptFile[]; after: ScriptFile[] };
export class AutomationService {
  constructor(private store: AutomationStore, private google: ScriptGateway, private key: string) {}
  async source(scriptId: string) {
    await this.store.project(scriptId);
    const files = await this.google.read(scriptId);
    const hash = sourceHash(files);
    await this.store.snapshot(scriptId, hash, seal(files,this.key));
    return { files: publicFiles(files), hash, refreshedAt: new Date().toISOString() };
  }
  async draft(scriptId: string, baseHash: unknown, files: unknown, reason: unknown, actor: string) {
    await this.store.project(scriptId);
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 2000) throw new AutomationError(400, 'Give a change reason between 5 and 2000 characters.');
    const before = await this.google.read(scriptId);
    const hash = sourceHash(before);
    if (hash !== baseHash) throw new AutomationError(409, 'Google source changed since you opened it. Reload the source and review your edits.');
    const after = restoreMaskedFiles(before, files);
    validateEditableSource(before,after);
    const changed = changedFiles(before,after);
    if (!changed.length) throw new AutomationError(400, 'There are no source changes to save.');
    const id = randomUUID();
    await this.store.saveDraft({ id,script_id:scriptId,actor_id:actor,reason:reason.trim(),base_hash:hash,target_hash:sourceHash(after),source_ciphertext:seal({before,after},this.key),changed_files:changed });
    return this.review(scriptId,id);
  }
  async review(scriptId: string, draftId: string) {
    const draft = await this.store.draft(draftId,scriptId);
    const { source_ciphertext, ...metadata } = draft;
    const source = unseal<DraftSource>(source_ciphertext,this.key);
    return { ...metadata, before:publicFiles(source.before),after:publicFiles(source.after) };
  }
  async restore(scriptId: string, draftId: string, reason: unknown, actor: string) {
    const historical = await this.store.draft(draftId,scriptId);
    if (!historical.published_by) throw new AutomationError(400, 'This draft has never been applied.');
    const backup = unseal<DraftSource>(historical.source_ciphertext,this.key).before;
    const current = await this.google.read(scriptId);
    validateEditableSource(current,backup);
    // Restoration is a NEW reviewable draft, never a direct write. Credentials come
    // from the encrypted historical backup, not editable browser placeholders.
    if (typeof reason !== 'string' || reason.trim().length < 5 || reason.length > 2000) throw new AutomationError(400,'Give a restoration reason between 5 and 2000 characters.');
    const changed = changedFiles(current,backup);
    if (sourceHash(current) === sourceHash(backup)) throw new AutomationError(400,'The current Google source already matches this backup.');
    const id = randomUUID();
    await this.store.saveDraft({id,script_id:scriptId,actor_id:actor,reason:`Restore backup: ${reason.trim()}`,base_hash:sourceHash(current),target_hash:sourceHash(backup),source_ciphertext:seal({before:current,after:backup},this.key),changed_files:changed});
    return this.review(scriptId,id);
  }
  async publish(scriptId: string, draftId: string, actor: string, acknowledged: unknown) {
    if (acknowledged !== true) throw new AutomationError(400,'Acknowledge that existing Google triggers will use the applied source.');
    return this.store.locked(scriptId, async store => {
      const draft = await store.draft(draftId,scriptId);
      if (draft.status === 'applied') return {status:'applied',id:draft.id};
      if (draft.status !== 'draft') throw new AutomationError(409,'This update has already been attempted. Reload Google source and prepare a new draft after reconciling its result.');
      const source = unseal<DraftSource>(draft.source_ciphertext,this.key);
      if (sourceHash(source.after) !== draft.target_hash || sourceHash(source.before) !== draft.base_hash) throw new AutomationError(500,'Draft integrity check failed.');
      const current = await this.google.read(scriptId);
      if (sourceHash(current) !== draft.base_hash) throw new AutomationError(409,'Google source changed after this draft was prepared. Reload and create a new draft.');
      // Durable encrypted backup and intent are committed BEFORE the Google write.
      await store.status(draft.id,'applying',actor);
      try {
        await this.google.write(scriptId,normalizeFiles(source.after));
        const saved = await this.google.read(scriptId);
        if (sourceHash(saved) !== draft.target_hash) {
          await store.status(draft.id,'verification_required',actor);
          throw new AutomationError(409,'Google source differs from the draft after applying. Inspect Google source before making another change.');
        }
        await store.snapshot(scriptId,draft.target_hash,seal(saved,this.key));
        await store.status(draft.id,'applied',actor);
        return {status:'applied',id:draft.id};
      } catch(error) {
        // A transport failure may occur AFTER Google accepted a write. Never
        // retry it automatically or claim that the script remained unchanged.
        await store.status(draft.id,'verification_required',actor).catch(() => {});
        if (error instanceof AutomationError) throw error;
        throw new AutomationError(503,'The Google update result could not be verified. Reload Google source and compare it with this draft before retrying.');
      }
    });
  }
}
