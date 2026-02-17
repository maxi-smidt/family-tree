# Issue Templates Preview

This document shows what users will see when creating issues with the new templates.

## Template Selection

When users click "New Issue", they will see three template options:

```
┌─────────────────────────────────────────────────────────────┐
│  Choose an issue template                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  🐛 Bug Report                                [Get started] │
│  Report a bug or unexpected behavior in the                 │
│  Family Tree application                                    │
│                                                             │
│  ✨ Feature Request                           [Get started] │
│  Suggest a new feature or enhancement for the               │
│  Family Tree application                                    │
│                                                             │
│  📚 Documentation                             [Get started] │
│  Report an issue with documentation or suggest              │
│  documentation improvements                                 │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Don't see your issue here?                                 │
│  💬 GitHub Discussions                                      │
│  🤝 Contributing Guide                                      │
│  📖 Documentation                                           │
└─────────────────────────────────────────────────────────────┘
```

## Bug Report Template Fields

1. **Bug Description** (required)
   - Clear description of the bug
   - Example placeholder provided

2. **Steps to Reproduce** (required)
   - Numbered list format
   - Pre-filled with 1, 2, 3 structure

3. **Expected Behavior** (required)
   - What should happen

4. **Actual Behavior** (required)
   - What actually happens

5. **Environment** (required)
   - OS, App Version, Database info
   - Pre-structured format

6. **Error Messages / Console Logs**
   - Code block with shell syntax highlighting
   - Instructions for finding console logs

7. **Relevant Files/Components**
   - Helps Copilot locate code
   - Examples provided

8. **Screenshots / Videos**
   - Drag-and-drop support

9. **Additional Context**
   - Open-ended field

10. **Pre-submission Checklist**
    - Search for duplicates
    - All info included
    - Version specified

## Feature Request Template Fields

1. **Feature Summary** (required)
   - Concise feature description

2. **Problem Statement** (required)
   - Why is this needed?

3. **Proposed Solution** (required)
   - How should it work?

4. **Feature Category** (required dropdown)
   - Tree View / Visualization
   - Member Management / Profiles
   - Gallery / Photos
   - Timeline / Events
   - Database Management
   - Import / Export
   - UI / UX
   - Internationalization
   - Performance
   - Other

5. **Technical Details**
   - Implementation suggestions
   - File paths
   - Libraries/APIs
   - Component names

6. **UI Mockup / Design**
   - Visual description
   - Image upload support

7. **Acceptance Criteria**
   - Checklist format
   - Pre-filled with [ ] items

8. **Alternative Solutions**
   - Other approaches considered

9. **Related Files / Components**
   - Files that need modification
   - Examples provided

10. **Priority** (required dropdown)
    - Low - Nice to have
    - Medium - Would significantly improve workflow
    - High - Critical for use case

11. **Additional Context**
    - Open-ended field

12. **Pre-submission Checklist**
    - Search for duplicates
    - Clear acceptance criteria
    - Aligns with project goals

## Documentation Template Fields

1. **Documentation Issue Summary** (required)
   - What needs to be added/fixed?

2. **Issue Type** (required dropdown)
   - Missing documentation
   - Incorrect or outdated information
   - Unclear or confusing explanation
   - Typo or formatting issue
   - New documentation needed
   - Code example needed
   - Other

3. **Documentation Location** (required dropdown)
   - README.md
   - docs/AGENTS.md
   - docs/COPILOT.md
   - docs/SETUP.md
   - docs/I18N_GUIDE.md
   - Code comments
   - New file needed
   - Other

4. **Specific File Path**
   - Exact path to file
   - Examples provided

5. **Current Documentation**
   - What's currently documented

6. **Proposed Documentation** (required)
   - What should it say?

7. **Why is this needed?** (required)
   - Justification

8. **Code Example**
   - TypeScript syntax highlighting
   - Code block format

9. **Related References**
   - Links to docs, issues, resources

10. **Target Audience**
    - Checklist format:
      - New contributors
      - GitHub Copilot / AI agents
      - End users
      - Maintainers

11. **Additional Context**
    - Open-ended field

12. **Pre-submission Checklist**
    - Check documentation doesn't exist
    - Clear suggestions provided
    - Target audience considered

## Copilot-Friendly Features

### 💡 Tooltips Throughout

Each template includes helpful tips like:

- "The more specific you are about file paths, error messages, and expected behavior, the better Copilot can assist"
- "Clear technical requirements, file paths, and UI mockups help Copilot generate accurate implementations"
- "Specific file paths and clear descriptions help Copilot make accurate documentation updates"

### Structured Data Collection

- Dropdowns for categorization
- Pre-formatted text areas
- Checklists for acceptance criteria
- Code blocks with syntax highlighting

### File Path Emphasis

Every template includes dedicated sections asking for:

- Relevant files
- Related components
- Specific paths
- Component names

### Technical Context Sections

Prompts users to provide:

- Implementation hints
- Library suggestions
- API references
- Code examples

### Clear Success Criteria

- Acceptance criteria in checklist format
- Expected vs. actual behavior separation
- Target audience identification
- Priority levels

## Configuration Benefits

The `config.yml` file:

- **Disables blank issues**: Ensures all issues use templates
- **Links to resources**: Guides users to appropriate channels
- **Reduces noise**: Filters general questions to Discussions

## Example Issue Title Formats

Templates pre-fill titles with:

- `[Bug]: ` for bug reports
- `[Feature]: ` for feature requests
- `[Docs]: ` for documentation

This helps with:

- Issue filtering and search
- Automated labeling
- Quick identification of issue type

## Validation and Quality

Pre-submission checklists ensure:

- No duplicate issues
- Complete information provided
- Appropriate template used
- Project alignment confirmed
