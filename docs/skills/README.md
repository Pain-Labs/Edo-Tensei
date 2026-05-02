# docs/skills — Design Reference Documents

These files are **design reference documentation for humans**, not the generated skill outputs consumed by AI IDEs.

## Single Source of Truth

The authoritative skill content lives in:

```
src/core/SkillGenerator.ts
```

`SkillGenerator.ts` contains the templated skill body for all supported targets. When a user runs the **Generate Agent Skill** command (`edoTensei.generateAgentSkill`) from the Command Palette, it writes the skill or rule to the appropriate agent directory:

| Target | Generated Path |
|--------|----------------|
| Claude Code | `.claude/skills/edo-tensei/SKILL.md` |
| GitHub Copilot | `.github/skills/edo-tensei/SKILL.md` |
| Kiro | `.kiro/skills/edo-tensei/SKILL.md` |
| Antigravity | `.agents/skills/edo-tensei/SKILL.md` |
| Cline | `.cline/skills/edo-tensei/SKILL.md` |
| Gemini CLI | `.gemini/skills/edo-tensei/SKILL.md` |
| Cursor | `.cursor/rules/edo-tensei.mdc` |

The extension can optionally help add these generated paths to `.gitignore`, but it does **not** do that automatically.

## Role of This Directory

Files here (`session-*.md`) document the **research, path conventions, and format notes** used to design the skill:

- Per-IDE storage paths (Windows, Linux, macOS, SSH remote)
- Session file formats (JSONL, JSON, SQLite)
- Quick handoff command examples
- Edge case notes (binary files, large sessions, missing permissions)

These files inform updates to `SkillGenerator.ts`. If you need to update the skill content (e.g., add a new IDE path), update the template in `SkillGenerator.ts` — **do not edit the generated files directly**, and do not treat the docs here as a second source of truth.
