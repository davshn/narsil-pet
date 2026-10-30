# Narsil

A Claude Code mod: Narsil, a chibi sea serpent who lives above the prompt and shows at a glance what Claude is doing. Her words are in Spanish.

- **States at a glance**: working, stopped, needs you, done, error, each with its own painted pose and animation (light and dark themes).
- **Floating window** (Windows, Edge): pops up while Claude is minimized or when something needs you, and lists every open conversation by state.
- **Voice and toasts**: a Spanish voice and a Windows notification when a turn ends, a question or a permission dialog waits for you, or a turn fails.
- **Tips**: short, concrete advice about the work in progress, from Haiku after a turn, after repeated failures or on a long turn; `/narsil consejo profundo` asks over the conversation itself.
- **Usage bars**: context window, 5-hour and weekly limits.

## Install

```
/plugin marketplace add davshn/narsil-pet
/plugin install narsil-pet@narsil
```

## Commands

```
/narsil estado | ocultar | mostrar | silencio | voz | flotante | prueba
/narsil consejo [profundo]
/narsil consejos on | off | cada <min> | voz
```

## Development

```
claude plugin validate .claude-plugin/plugin.json
claude plugin test .
```

The art in `hooks/art.ts` is generated from `assets/raw` by `tools/build-art.ps1`.
