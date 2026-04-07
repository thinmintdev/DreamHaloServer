---
name: memory-maintenance
description: Automated memory hygiene for MintOps. Triggers on "memory maintenance", "light tier", "daily tier", "weekly tier", "reindex memory", "clean up memory", "memory hygiene". Runs at three intensity levels to keep the workspace memory accurate, deduplicated, and properly indexed.
---

# Memory Maintenance

Maintain the MintOps workspace memory system. This skill runs at three tiers triggered by cron or manual request.

## Memory Layout

    workspace-mintops/
      MEMORY.md                    # Index file (keep under 150 lines)
      memory/
        platform/                  # Synced from Claude Code - READ ONLY, never edit
          project_dreamhalo.md
          user_alexander.md
          feedback_deployment.md
        archive/                   # Old daily notes moved here by weekly cleanup
        <topic>.md                 # Your working memory files

**Rules:**
- Never edit files in memory/platform/ - they are synced from upstream
- MEMORY.md is the index; each entry should be one line under 150 chars
- Topic files use frontmatter: name, description, type (infrastructure, incident, operational, learning)
- Prefer updating existing topic files over creating new ones

## Tier: Light

Trigger: message contains "light tier" or "memory index". Runs every 4 hours via cron.

Do exactly one thing:
1. Run: exec openclaw memory index --force

Report the output. Nothing else.

## Tier: Daily

Trigger: message contains "daily tier" or runs at 6am via cron.

Steps:
1. Read recent session transcripts (last 24h) from the sessions directory
2. Extract key learnings, decisions, infrastructure changes, and incidents
3. For each extracted fact:
   - Check if it already exists in a topic memory file - skip if duplicate
   - If a relevant topic file exists, append to it
   - If no topic file fits, create a new one with proper frontmatter
4. Update MEMORY.md index to include any new topic files
5. Remove any MEMORY.md entries that point to deleted files
6. Run: exec openclaw memory index --force (rebuild embeddings)
7. Report: "Daily maintenance complete. X new facts extracted, Y files updated, Z new files created."

Time budget: ~3 minutes. Focus on accuracy over coverage.

## Tier: Weekly

Trigger: message contains "weekly tier" or runs Monday 5am via cron.

Steps:
1. **Verify facts**: Read each topic memory file. For infrastructure claims (container status, model configs, service health), verify against current state:
   - Run exec docker ps --format "table {{.Names}}\t{{.Status}}" for container status
   - Check .env for current DREAM_STACK value
   - Run exec openclaw memory status for index health
   - Update or remove facts that are no longer true
2. **Deduplicate**: Scan all topic files for overlapping information. Merge duplicates into the more comprehensive file, delete the sparser one.
3. **Archive old daily notes**: Move files in memory/ matching YYYY-MM-DD.md pattern older than 14 days to memory/archive/. Create the archive directory if needed.
4. **Compact MEMORY.md**: If over 100 lines, consolidate related entries, remove redundant pointers, tighten descriptions.
5. **Platform sync check**: List memory/platform/ files and note their modification dates. If any are older than 7 days, add a note to MEMORY.md flagging potential staleness.
6. **Full reindex**: Run exec openclaw memory index --force
7. Report: "Weekly maintenance complete. X facts verified, Y stale entries removed, Z files archived."

Time budget: ~8 minutes. Thoroughness is more important than speed.

## Output Format

Always end maintenance with a brief summary. For cron runs (no human watching), write the summary to memory/maintenance-log.md (append, most recent first, keep last 20 entries).
