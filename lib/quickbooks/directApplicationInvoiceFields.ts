import { qboReadPreferences } from '../services/qboInvoiceService';

const PURCHASE_ORDER_CUSTOM_FIELD_NAME = 'Purchase Order #';
let cachedPurchaseOrderDefinitionId: string | null | undefined;

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeName(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function collectObjects(value: unknown, out: any[] = []): any[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectObjects(item, out);
    return out;
  }

  out.push(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectObjects(child, out);
  }
  return out;
}

async function resolvePurchaseOrderDefinitionId(): Promise<string | null> {
  const envId = process.env.QBO_PURCHASE_ORDER_CUSTOM_FIELD_ID?.trim();
  if (envId) return envId;
  if (cachedPurchaseOrderDefinitionId !== undefined) return cachedPurchaseOrderDefinitionId;

  try {
    const preferences = await qboReadPreferences(undefined);
    const field = collectObjects(preferences).find(
      obj =>
        normalizeName(obj?.Name) === normalizeName(PURCHASE_ORDER_CUSTOM_FIELD_NAME) &&
        obj?.DefinitionId
    );
    cachedPurchaseOrderDefinitionId = field?.DefinitionId ? String(field.DefinitionId) : '1';
  } catch (err) {
    console.warn('[QBO invoice fields] Could not read custom field preferences; using DefinitionId 1 for Purchase Order #:', err);
    cachedPurchaseOrderDefinitionId = '1';
  }

  return cachedPurchaseOrderDefinitionId;
}

export async function buildPurchaseOrderInvoiceFields(
  purchaseOrderNumber: string | null | undefined,
  existingInvoiceRaw?: any
): Promise<Record<string, any>> {
  const po = String(purchaseOrderNumber || '').trim();
  if (!po) return {};

  const definitionId = await resolvePurchaseOrderDefinitionId();
  const existingCustomFields = asArray(existingInvoiceRaw?.CustomField).filter(field => {
    const isPurchaseOrderByName = normalizeName(field?.Name) === normalizeName(PURCHASE_ORDER_CUSTOM_FIELD_NAME);
    const isPurchaseOrderById = definitionId && String(field?.DefinitionId || '').trim() === definitionId;
    return !isPurchaseOrderByName && !isPurchaseOrderById;
  });

  return {
    PONumber: po,
    CustomField: [
      ...existingCustomFields,
      {
        ...(definitionId ? { DefinitionId: definitionId } : {}),
        Name: PURCHASE_ORDER_CUSTOM_FIELD_NAME,
        Type: 'StringType',
        StringValue: po,
      },
    ],
  };
}
