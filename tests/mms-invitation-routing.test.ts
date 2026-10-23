import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

test('MMS connection failure cannot block normal trainer invitations or change funded routing', async () => {
    const Module = require('node:module'); const original = Module._load;
    const previous = { ...process.env }; let queries = 0;
    Module._load = function(name: string, parent: any, ...rest: any[]) {
        if (Module._resolveFilename(name, parent) === path.resolve('lib/db.ts'))
            return { __esModule: true, default: { query: async () => { queries++; throw new Error('Synthetic integration unavailable'); } } };
        return original.call(this, name, parent, ...rest);
    };
    try {
        process.env.MMS_SYNC_ENABLED = 'true'; process.env.MMS_SYNC_AUTOMATIC = 'true';
        const { invitationAccess, prepareClassAccess } = require('../lib/mmsSync/accessContext');
        assert.deepEqual(await invitationAccess({ courseCode: ' tgs-123 ' }), { platform: 'tms', state: 'legacy' });
        assert.equal(queries, 0);
        const pending = await invitationAccess({ courseCode: 'C817', runUuid: 'fixture' });
        assert.equal(pending.platform, 'review'); assert.equal(pending.state, 'pending');
        const held = await prepareClassAccess({ courseCode: 'C817', runUuid: 'fixture' });
        assert.equal(held.platform, 'review'); assert.equal(held.class_url, undefined);
    } finally {
        Module._load = original;
        for (const key of ['MMS_SYNC_ENABLED', 'MMS_SYNC_AUTOMATIC']) {
            if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
        }
    }
});
