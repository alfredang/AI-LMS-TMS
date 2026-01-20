# Base URL Migration Guide

## Overview
Migrating from hardcoded `localhost:3001` URLs to environment-based configuration using `NEXT_PUBLIC_BASE_URL`.

## Quick Setup

Your [.env.local](.env.local) file already has:
```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000
```

For production, just update these to your domain:
```env
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
BASE_URL=https://yourdomain.com
```

## Tools Available

### 1. Configuration Module ([lib/config.ts](lib/config.ts))
```typescript
import { getBaseUrl, getApiBaseUrl, config } from '@/lib/config';

const baseUrl = getBaseUrl();        // Get base URL
const apiUrl = getApiBaseUrl();      // Get API base URL
```

### 2. URL Helper Utilities ([lib/urlHelpers.ts](lib/urlHelpers.ts))
```typescript
import { getApiUrl, getFileUrl, getDownloadUrl } from '@/lib/urlHelpers';

// API URLs
const url = getApiUrl('/api/courses/list');
// → http://localhost:3000/api/courses/list

// File URLs
const fileUrl = getFileUrl('/uploads/image.png');
// → http://localhost:3000/uploads/image.png

// Download URLs
const downloadUrl = getDownloadUrl('/uploads/doc.pdf');
// → http://localhost:3000/api/download/uploads/doc.pdf
```

## Migration Examples

### Before:
```typescript
const response = await fetch('http://localhost:3001/api/courses/list');
const imageUrl = `http://localhost:3001${filePath}`;
```

### After:
```typescript
import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';

const response = await fetch(getApiUrl('/api/courses/list'));
const imageUrl = getFileUrl(filePath);
```

## Already Updated Files
- ✅ [utils/imageUtils.ts](utils/imageUtils.ts)
- ✅ [lib/services/profileService.ts](lib/services/profileService.ts)
- ✅ [lib/services/courseApiService.ts](lib/services/courseApiService.ts)

## Find Remaining Files

```bash
node scripts/update-localhost-urls.js
```

## Benefits

- ✅ Change URLs via environment variables (no code changes)
- ✅ Easy deployment to different environments
- ✅ Single source of truth for all URLs
- ✅ Type-safe URL construction
