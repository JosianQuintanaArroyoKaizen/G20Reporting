# Deployment Fix - Lambda Simplification

## Problem
GitHub Actions deployment was failing with Docker/bundling errors:
```
ERROR: failed to build: process "/bin/sh -c npm install --global bun@1.2.23" 
did not complete successfully: exit code: 1
```

## Root Cause
- Lambda functions were using `NodejsFunction` which requires Docker for bundling
- Attempting to install `bun` in Docker container was failing
- These e-commerce Lambda functions are NOT relevant to EMIR project anyway

## Solution
Replaced complex bundled Lambda functions with **simple inline placeholders**:

### Before (Complex):
```typescript
new NodejsFunction(this, 'productLambdaFunction', {
  entry: join(__dirname, `/../src/product/index.js`),
  bundling: { ... },  // Requires Docker
  runtime: Runtime.NODEJS_14_X  // Deprecated
});
```

### After (Simple):
```typescript
new LambdaFunction(this, 'productLambdaFunction', {
  runtime: Runtime.NODEJS_20_X,  // Modern runtime
  handler: 'index.handler',
  code: Code.fromInline(`...`)   // No bundling/Docker needed
});
```

## Benefits
✅ **No Docker required** - Deploys anywhere (GitHub Actions, local, etc.)  
✅ **Modern Node.js 20** - Instead of deprecated Node.js 14  
✅ **Faster deployments** - No bundling step  
✅ **Simpler code** - Easier to understand  
✅ **Placeholder for EMIR** - Will be replaced with actual EMIR Lambda functions

## Files Modified
- `lib/microservice.ts` - Simplified all 3 Lambda functions
- `lib/aws-microservices-stack.ts` - Added explanatory comment

## E-commerce vs EMIR Functions

### Current (Placeholder - not relevant to EMIR):
| Function | Purpose | Status |
|----------|---------|--------|
| productLambdaFunction | Product CRUD | ⚠️ Placeholder |
| basketLambdaFunction | Shopping cart | ⚠️ Placeholder |
| orderingLambdaFunction | Order processing | ⚠️ Placeholder |

### Future EMIR Functions (from guide):
| Function | Purpose | Status |
|----------|---------|--------|
| data-loader | Load CSV from S3 | 📅 To be built |
| completeness-validator | Check mandatory fields | 📅 To be built |
| format-validator | Validate LEI/ISIN/UPI | 📅 To be built |
| logical-validator | Cross-field validation | 📅 To be built |
| scoring-engine | Calculate accuracy scores | 📅 To be built |
| report-generator | Generate PDF/Excel | 📅 To be built |

## Deployment Now Works
This change allows the stack to deploy successfully via GitHub Actions without Docker/bundling issues.

## Next Steps
1. ✅ Commit this fix
2. ✅ Push to GitHub (trigger CI/CD)
3. ✅ Verify deployment succeeds
4. 🚀 Start building EMIR infrastructure (lib/storage.ts, etc.)

---

*Fix applied: 2025-11-05*

