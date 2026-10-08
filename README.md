# project-status

A Claude Code mod that adds a two-row band above the prompt:

- project and git branch
- overall progress (bar + percent)
- current experiment and its status: أولية (initial) · تصحيح لفشل سابق (fix of a failure) · تطوير لتجربة ناجحة (development of a success), with result running / success / fail
- session time, 5-hour and weekly usage with reset countdowns

## Install

At the prompt of a terminal Claude Code session:

```
/plugin install project-status --marketplace tuamah/mods
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

## Use

| Command | Effect |
|---|---|
| `/pstatus progress 40` | set progress |
| `/pstatus exp T5 develop success` | set experiment: name, `initial`/`fix`/`develop`, `running`/`success`/`fail` |
| `/pstatus result fail` | change the current experiment's result |
| `/pstatus clear` | clear progress and experiment |
| `/pstatus hide` / `/pstatus show` | hide or show the band |
| `/pstatus` | print a summary |

Claude can also update the band itself through the `mcp__project-status__set_status` tool. Progress and experiment are saved per project and branch.

## Develop

```
claude plugin validate .
claude plugin test .
```
