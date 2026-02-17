# GitHub Issue Templates

This directory contains issue templates optimized for GitHub Copilot agents and human contributors.

## Available Templates

### 🐛 Bug Report (`bug_report.yml`)
Use this template to report bugs or unexpected behavior in the Family Tree application.

**Key Features:**
- Structured fields for bug description, reproduction steps, and expected behavior
- Environment information collection (OS, version, database)
- Error logs and console output sections
- Relevant file/component identification
- Screenshot/video support
- Pre-submission checklist

**Copilot Optimization:**
- Dedicated "Relevant Files/Components" section helps Copilot locate code quickly
- Error log sections provide stack traces and debugging context
- Clear expected vs. actual behavior helps Copilot understand the issue

### ✨ Feature Request (`feature_request.yml`)
Use this template to suggest new features or enhancements.

**Key Features:**
- Problem statement and proposed solution sections
- Feature category dropdown (Tree View, Member Management, Gallery, etc.)
- Technical details section for implementation hints
- UI mockup/design description area
- Acceptance criteria checklist
- Priority levels
- Related files/components section

**Copilot Optimization:**
- Technical details section guides users to provide file paths and APIs
- Acceptance criteria in checklist format creates clear, testable requirements
- Related files section helps Copilot scope the implementation
- UI mockup section provides visual context for UI changes

### 📚 Documentation (`documentation.yml`)
Use this template for documentation issues or improvements.

**Key Features:**
- Documentation type classification (missing, incorrect, unclear, etc.)
- Location dropdown (README, docs/AGENTS.md, code comments, etc.)
- Current vs. proposed content sections
- Code example support with syntax highlighting
- Target audience identification
- Related references section

**Copilot Optimization:**
- Specific file path field helps Copilot locate documentation quickly
- Proposed documentation section provides concrete examples
- Target audience helps Copilot adjust tone and detail level
- Code examples show exactly what needs to be documented

## Configuration (`config.yml`)

The config file:
- Disables blank issues to ensure all issues use structured templates
- Provides links to GitHub Discussions for general questions
- Points to contributing guides (docs/AGENTS.md)
- References project documentation

## Using These Templates

When creating a new issue on GitHub:

1. Click "New Issue"
2. Choose the appropriate template:
   - **Bug Report**: For bugs, crashes, or unexpected behavior
   - **Feature Request**: For new features or enhancements
   - **Documentation**: For documentation gaps or improvements
3. Fill out all required fields (marked with *)
4. Provide as much detail as possible in technical/file path sections
5. Complete the pre-submission checklist

## Tips for GitHub Copilot Agents

When a Copilot agent receives an issue created with these templates:

1. **File Paths**: Check "Relevant Files/Components" or "Related Files" sections first
2. **Technical Context**: Review "Technical Details" sections for implementation hints
3. **Acceptance Criteria**: Use checklists as test specifications
4. **Error Logs**: Parse error messages and stack traces for debugging clues
5. **Code Examples**: Use provided examples as specifications

## Template Design Philosophy

These templates are designed to:

1. **Reduce Ambiguity**: Structured fields prevent vague descriptions
2. **Provide Context**: Technical details help AI agents understand requirements
3. **Enable Automation**: Clear structure allows AI parsing and action
4. **Guide Users**: Placeholders and examples show what information is needed
5. **Maintain Quality**: Pre-submission checklists ensure completeness

## Maintenance

When updating these templates:

1. Maintain YAML syntax validation
2. Keep dropdown options aligned with current project structure
3. Update file path examples when project structure changes
4. Test templates by creating sample issues
5. Gather feedback from both human and AI contributors

## Related Documentation

- [AGENTS.md](../../docs/AGENTS.md) - Development guidelines
- [COPILOT.md](../../docs/COPILOT.md) - Copilot-specific guidelines
- [GitHub Issue Forms Syntax](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)
