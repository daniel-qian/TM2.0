# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

> Note (corrected 2026-07-18, feat-068): **all five labels DO exist** in `daniel-qian/avery` — verified with `gh label list`. The earlier note here claimed they did not, which was wrong and would have sent someone to create duplicates. `gh issue edit --add-label` works against them today.
>
> Also corrected: until 2026-07-18 every line filed its work as local `.issues/` files with a "未建 GitHub issue（对外闸留 Danny）" note. **That gate is now open** — Danny authorised the push to `origin/main` and chose GitHub issues as the tracker for the deployment line onward. See `AGENTS.md` § Issue tracker.
