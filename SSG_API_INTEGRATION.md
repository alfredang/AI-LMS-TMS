# SSG API Integration Guide

This document provides a comprehensive guide for the SSG (SkillsFuture Singapore) API integration that has been migrated from the Python reference implementation to your Next.js TypeScript project.

## Overview

The SSG API integration allows your application to interact with Singapore's SkillsFuture system to manage courses, enrolments, assessments, and other training-related data. This implementation includes:

- **Course Management**: View, add, edit, and delete course runs
- **Session Management**: Manage course sessions and schedules  
- **Encryption/Decryption**: Handle secure data transmission
- **Validation**: Comprehensive data validation for Singapore standards

## Project Structure

```
server/
├── lib/ssg/
│   ├── api/
│   │   └── course-api.ts          # Main SSG API client
│   ├── models/
│   │   └── course-runs.ts         # TypeScript interfaces and types
│   └── utils/
│       ├── cryptography.ts        # AES-256 encryption/decryption
│       ├── http-utils.ts          # HTTP request utilities
│       └── validators.ts          # Data validation functions
├── pages/api/ssg/
│   ├── courses.ts                 # Course CRUD operations
│   └── courses/[...]/sessions/    # Course sessions endpoint
└── .env.example                   # Environment configuration

client/
├── src/
│   ├── components/ssg/
│   │   ├── SSGCourses.tsx         # Main SSG UI component
│   │   ├── ViewCourseRun.tsx      # View course run details
│   │   ├── AddCourseRun.tsx       # Add new course runs
│   │   ├── EditDeleteCourseRun.tsx # Edit/delete operations
│   │   ├── ViewCourseSessions.tsx  # View course sessions
│   │   └── EncryptionDecryption.tsx # Crypto utilities UI
│   ├── types/
│   │   └── ssg.ts                 # Client-side type definitions
│   └── ui/                        # Reusable UI components
└── pages/
    └── ssg-courses.tsx            # SSG courses page
```

## Setup Instructions

### 1. Environment Configuration

Copy the environment variables from `.env.example` and configure them:

```env
# SSG API Configuration
SSG_API_BASE_URL=https://api.ssg-wsg.gov.sg
SSG_API_VERSION=v1

# SSG Authentication
SSG_AUTH_TOKEN=your-bearer-token-here

# SSG Encryption
SSG_ENCRYPTION_KEY=your-base64-encoded-aes-256-key-here

# SSG SSL Certificates (if required)
SSG_CERT_PATH=/path/to/certificate.pem
SSG_KEY_PATH=/path/to/private-key.pem
```

### 2. Install Dependencies

The integration uses the following key dependencies:

```bash
# Server dependencies (built-in Node.js modules)
# - crypto (for encryption)
# - fs (for file operations)

# Client dependencies
npm install lucide-react  # For icons (already installed)
```

### 3. API Key Setup

1. Obtain your SSG API credentials from the SSG Developer Portal
2. Generate or obtain your AES-256 encryption key (base64 encoded)
3. Set up SSL certificates if required by your SSG environment

## Key Components

### Server-Side Components

#### SSG API Client (`server/lib/ssg/api/course-api.ts`)

The main API client provides methods for:

```typescript
const ssgAPI = createSSGCourseAPI(baseUrl, authToken, encryptionKey);

// View course run
await ssgAPI.viewCourseRun(runId, includeExpired);

// Add course run (encrypted)
await ssgAPI.addCourseRun(runInfo, includeExpired);

// Edit course run (encrypted)  
await ssgAPI.editCourseRun(runInfo, includeExpired);

// Delete course run (encrypted)
await ssgAPI.deleteCourseRun(runInfo, includeExpired);

// View course sessions
await ssgAPI.viewCourseSessions(courseRefNum, runId, includeExpired);
```

#### Encryption Utilities (`server/lib/ssg/utils/cryptography.ts`)

Handles AES-256/CBC/PKCS7 encryption required for certain SSG APIs:

```typescript
import { Cryptography } from './cryptography';

// Encrypt data
const encrypted = Cryptography.encrypt(key, plaintext, false);

// Decrypt data  
const decrypted = Cryptography.decrypt(key, ciphertext, false);

// Encrypt JSON objects
const encryptedJson = Cryptography.encryptJSON(key, dataObject);

// Decrypt JSON objects
const decryptedObject = Cryptography.decryptJSON(key, encryptedJson);
```

#### Validation (`server/lib/ssg/utils/validators.ts`)

Singapore-specific validation functions:

```typescript
import { Validators, SSGValidators } from './validators';

// Validate UEN (Unique Entity Number)
Validators.verifyUEN('123456789A');

// Validate NRIC/FIN
Validators.verifyNRIC('S1234567A');

// Validate course-specific data
SSGValidators.validateCourseReferenceNumber('XX-1000----K-01-TEST 166');
```

### Client-Side Components

#### Main SSG Interface (`client/src/components/ssg/SSGCourses.tsx`)

A tabbed interface providing access to all SSG functionality:

- **View Course Runs**: Search and display course run details
- **Add Course Runs**: Create new course runs with sessions
- **Edit/Delete Course Runs**: Modify or remove existing course runs
- **View Course Sessions**: Display session details for courses
- **En-Decryption**: Utility for encrypting/decrypting data

#### Individual Components

Each tab is implemented as a separate component for modularity:

- `ViewCourseRun.tsx`: Fetch and display course run details
- `AddCourseRun.tsx`: Form for creating new course runs  
- `EditDeleteCourseRun.tsx`: Edit and delete operations
- `ViewCourseSessions.tsx`: Session management interface
- `EncryptionDecryption.tsx`: Encryption utility interface

## API Endpoints

### Course Operations

#### GET /api/ssg/courses
View course run by ID

**Query Parameters:**
- `runId`: Course run identifier
- `includeExpired`: Include expired courses (true/false)

**Headers:**
- `Authorization`: Bearer token
- `x-encryption-key`: AES-256 key (if needed)

#### POST /api/ssg/courses  
Add new course run

**Body:** AddRunInfo object (will be encrypted automatically)

#### PUT /api/ssg/courses
Edit existing course run

**Body:** EditRunInfo object (will be encrypted automatically)

#### DELETE /api/ssg/courses
Delete course run

**Body:** DeleteRunInfo object (will be encrypted automatically)

### Course Sessions

#### GET /api/ssg/courses/[courseReferenceNumber]/sessions/[runId]
View course sessions

## Data Models

### Course Run Information

```typescript
interface AddRunInfo {
  course: {
    courseReferenceNumber: string;
    trainingProvider: {
      uen: string;
      code?: string;
    };
  };
  runs: RunInfo[];
}

interface RunInfo {
  sequenceNumber?: number;
  registrationDates?: {
    opening?: string; // YYYYMMDD format
    closing?: string; // YYYYMMDD format  
  };
  courseDates?: {
    start?: string;   // YYYYMMDD format
    end?: string;     // YYYYMMDD format
  };
  scheduleInfoType?: {
    code: string;
    description?: string;
  };
  scheduleInfo?: string;
  venue?: Venue;
  intakeSize?: number;
  threshold?: number;
  modeOfTraining?: ModeOfTraining;
  courseAdminEmail?: {
    email: string;
  };
  courseVacancy?: {
    code: Vacancy;
    description?: string;
  };
  sessions?: RunSessionAddInfo[];
  linkCourseRunTrainer?: RunTrainerAddInfo[];
}
```

## Security Considerations

### Encryption Requirements

- **Add Course Run**: Requires encrypted payload
- **Edit Course Run**: Requires encrypted payload  
- **Delete Course Run**: Requires encrypted payload
- **View Course Run**: No encryption required
- **View Course Sessions**: No encryption required

### Key Management

- Store encryption keys securely in environment variables
- Use base64-encoded AES-256 keys (32 bytes)
- Rotate keys periodically as per security policy
- Never expose keys in client-side code

### Authentication

- Use Bearer tokens for API authentication
- Implement proper token refresh mechanisms
- Store tokens securely (server-side only)

## Error Handling

The implementation includes comprehensive error handling:

```typescript
interface SSGApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  status: number;
}
```

Common error scenarios:
- Invalid authentication tokens
- Malformed encryption keys
- Missing required fields
- Network connectivity issues
- SSG API rate limiting

## Testing

### Testing with Sample Data

The Python reference includes test data that can be adapted:

```typescript
// Sample course reference number
const testCourseRef = "XX-1000----K-01-TEST 166";

// Sample UEN
const testUEN = "T08GB0001A";

// Sample dates (YYYYMMDD format)
const testDate = "20231231";
```

### API Testing

Test the endpoints using tools like:
- Postman
- curl
- Your application's UI components

Example curl command:
```bash
curl -X GET "http://localhost:3001/api/ssg/courses?runId=12345&includeExpired=false" \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json"
```

## Deployment Considerations

### Environment-Specific Configuration

Configure different endpoints for different environments:

- **Development**: SSG UAT environment
- **Staging**: SSG pre-production environment  
- **Production**: SSG production environment

### Performance Optimization

- Implement caching for frequently accessed course data
- Use connection pooling for HTTP requests
- Consider implementing request rate limiting

### Monitoring

- Log all API interactions for debugging
- Monitor encryption/decryption performance
- Track API response times and error rates

## Migration from Python Reference

This TypeScript implementation maintains functional parity with the Python reference while adapting to the Next.js ecosystem:

### Key Differences

1. **Async/Await**: TypeScript implementation uses modern async patterns
2. **Type Safety**: Full TypeScript type definitions for better development experience
3. **React Components**: Modern React functional components instead of Streamlit
4. **Modular Architecture**: Cleaner separation of concerns

### Preserved Functionality

- All encryption/decryption algorithms maintained
- Identical API request/response handling
- Same data validation rules
- Consistent error handling patterns

## Troubleshooting

### Common Issues

1. **Encryption Key Errors**
   - Ensure key is exactly 32 bytes when base64 decoded
   - Verify key format matches SSG requirements

2. **Authentication Failures**  
   - Check token validity and expiration
   - Verify token format (Bearer prefix)

3. **Network Errors**
   - Confirm SSL certificate configuration
   - Check firewall and proxy settings

4. **Data Validation Errors**
   - Verify UEN format for Singapore entities
   - Check date formats (YYYYMMDD)
   - Validate required fields per SSG API documentation

### Debug Mode

Enable detailed logging by setting:
```env
LOG_LEVEL=debug
```

This will output detailed request/response information for troubleshooting.

## Next Steps

1. **Complete Form Implementation**: Enhance the Add/Edit course run forms with full field support
2. **Additional APIs**: Implement other SSG APIs (Enrolment, Assessment, etc.)
3. **Advanced Features**: Add features like bulk operations, import/export
4. **Testing**: Implement comprehensive unit and integration tests
5. **Documentation**: Add API documentation using tools like Swagger/OpenAPI

## Support

For SSG API specific questions, refer to:
- [SSG Developer Portal](https://developer.ssg-wsg.gov.sg)
- SSG API Documentation
- Your SSG technical contact

For implementation questions, refer to the code comments and this documentation.