# CLAUDE.md

**你必须使用中文和我交流**

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an n8n community node starter repository for building custom integrations for n8n. The project creates npm packages containing custom nodes and credentials that extend n8n's functionality.

## Commands

### Development
- `npm run dev` - Watch mode compilation (tsc --watch)
- `npm run build` - Full build: cleans dist/, compiles TypeScript, and copies icons
- `npm run format` - Format code with Prettier (nodes and credentials directories)
- `npm run lint` - Lint code with ESLint
- `npm run lintfix` - Auto-fix linting errors where possible

### Publishing
- `npm run prepublishOnly` - Pre-publish validation (build + lint with stricter rules)

### Local Testing
To test nodes locally, link the package using `npm link` in this directory, then link it in your n8n installation.

## Architecture

### Node Structure
Nodes are TypeScript classes implementing `INodeType` with:
- **description**: `INodeTypeDescription` object defining UI properties, inputs/outputs, and node parameters
- **execute()**: Async method processing input items and returning output data

Key patterns:
- Use `this.getInputData()` to access input items
- Use `this.getNodeParameter(name, itemIndex)` to read node parameters
- Iterate over all input items, handling errors appropriately
- Return `INodeExecutionData[][]` (array of arrays)
- Set `usableAsTool: true` for AI agent compatibility

### Credential Structure
Credentials are TypeScript classes implementing `ICredentialType` with:
- **name**: Internal identifier (must end in "Api")
- **displayName**: User-facing name
- **properties**: Array of credential fields (`INodeProperties[]`)
- **authenticate**: Configuration for HTTP authentication
- **test**: Optional credential validation endpoint

### File Organization
- `nodes/` - Node implementations (each in own subdirectory)
  - `NodeName/NodeName.node.ts` - Main node class
  - `NodeName/*.ts` - Supporting files (operation descriptions, etc.)
  - `NodeName/*.svg` - Node icon
- `credentials/` - Credential implementations
  - `CredentialName.credentials.ts`
- `dist/` - Build output (git-ignored, npm-published)

### Build Process
1. TypeScript compilation (`tsc`) outputs to `dist/`
2. Gulp task copies PNG/SVG icons from `nodes/` and `credentials/` to `dist/`
3. `package.json` n8n field registers compiled nodes and credentials

### ESLint Configuration
Uses `eslint-plugin-n8n-nodes-base` with strict rules enforcing n8n conventions:
- Package.json: Community package standards
- Credentials: Naming, authentication, field validation
- Nodes: Resource/operation patterns, parameter conventions, error handling

Common violations to avoid:
- Empty strings in descriptions
- Missing default values
- Wrong parameter types for operations
- Missing documentation URLs
- Incorrect naming conventions (must end in "Api" for credentials)

### Resource/Operation Pattern
Complex nodes use the resource/operation pattern:
- **Resource**: Top-level category (e.g., "HTTP Verb")
- **Operation**: Specific action (e.g., "GET", "POST")
- Operations and fields typically split into separate files for maintainability

### Request Defaults
Nodes can define `requestDefaults` in their description for HTTP operations:
```typescript
requestDefaults: {
  baseURL: 'https://api.example.com',
  headers: { 'Accept': 'application/json' }
}
```

### Error Handling
- Use `NodeOperationError` for operation failures
- Check `this.continueOnFail()` for workflow-level error handling preference
- Include `itemIndex` in error context for debugging
- Preserve existing error context when re-throwing

## Key Dependencies
- `n8n-workflow`: Core types and utilities (peer dependency)
- `eslint-plugin-n8n-nodes-base`: Linting rules for n8n nodes
- TypeScript with strict mode enabled
