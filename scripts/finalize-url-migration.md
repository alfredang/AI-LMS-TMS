# URL Migration Status

## Completed Files ✅
- lib/config.ts (created)
- lib/urlHelpers.ts (created)
- utils/imageUtils.ts
- lib/services/profileService.ts
- lib/services/courseApiService.ts
- components/CourseEditor.tsx
- components/AdminDashboard.tsx
- components/CourseDetail.tsx
- components/common/LearnerProfileCard.tsx
- components/common/AdminProfileCard.tsx

## Remaining Files (with occurrence count)

### High Priority Components
- components/TrainerProfileCard.tsx (17 occurrences)
- components/GradingView.tsx (5 occurrences)
- components/TrainingProviderProfileCard.tsx (3 occurrences)
- components/TrainingProviderDashboard.tsx
- components/UpcomingClassesTable.tsx
- components/admin/* files

### Pattern Replacements Needed

For all remaining files, apply these changes:

1. **Add import at the top:**
```typescript
import { getApiUrl, getUploadUrl, getDeleteFileUrl, stripBaseUrl, getFileUrl, getDownloadUrl } from '@/lib/urlHelpers';
```

2. **Replace hardcoded URLs:**

| Old Pattern | New Pattern |
|-------------|-------------|
| `'http://localhost:3001/api/...'` | `getApiUrl('/api/...')` |
| `'http://localhost:3001/api/upload/trainer-file?fileType=cv'` | `getUploadUrl('trainer', 'cv')` |
| `'http://localhost:3001/api/upload/trainer-file?fileType=certification'` | `getUploadUrl('trainer', 'certification')` |
| `'http://localhost:3001/api/upload/trainer-file?fileType=profilePicture'` | `getUploadUrl('trainer', 'profilePicture')` |
| `.replace('http://localhost:3001', '')` | `stripBaseUrl(...) \|\| ...` |
| `` `http://localhost:3001${path}` `` | `getFileUrl(path)` |
| `` `http://localhost:3001/api/download/${path}` `` | `getApiUrl(\`/api/download/${path}\`)` |
| `` `http://localhost:3001/api/download${path}` `` | `getApiUrl(\`/api/download${path}\`)` |

### Manual Review Needed
After bulk replacements, manually review:
- Delete file operations
- Upload operations
- Path stripping logic
- Download URLs

## Environment Setup

Your `.env.local` should have:
```env
NEXT_PUBLIC_BASE_URL=http://localhost:3000
BASE_URL=http://localhost:3000
```

## Testing Checklist

After migration:
- [ ] File uploads work
- [ ] File downloads work
- [ ] Profile picture display works
- [ ] Course images display
- [ ] API calls succeed
- [ ] No console errors about missing URLs
