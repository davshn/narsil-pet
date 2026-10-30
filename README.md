# Narsil

A Claude Code mod: Narsil, a chibi sea serpent who lives above the prompt and shows at a glance what Claude is doing. Her words are in Spanish.

- **States at a glance**: working, stopped, needs you, done, error, each with its own painted pose and animation (light and dark themes).
- **Floating window**: pops up while Claude is minimized (on macOS, while another app is in front) or when something needs you, and lists every open conversation by state.
- **Voice and notifications**: a Spanish voice and a system notification when a turn ends, a question or a permission dialog waits for you, or a turn fails.
- **Tips**: short, concrete advice about the work in progress, from Haiku after a turn, after repeated failures or on a long turn; `/narsil consejo profundo` asks over the conversation itself.
- **Usage bars**: context window, 5-hour and weekly limits.

## Install

```
/plugin marketplace add davshn/narsil-pet
/plugin install narsil-pet@narsil
```

## Systems

The band, its animations, tips and usage bars work wherever Claude Code draws them: the terminal, the desktop app, VS Code and the mobile app. Voice, notifications and the floating window run on the computer where the session runs:

| | Windows | macOS | Other |
| --- | --- | --- | --- |
| Voice | Spanish voice (Windows) | `say`, in Mónica or Paulina when installed | the engine's voice |
| Notifications | Windows toast; a click opens the conversation | macOS notification | the engine's, if any |
| Floating window | Edge, always on top | Chrome, Edge or Brave, opened behind your app; needs Node.js | none |

On macOS the window is opened and closed rather than hidden (hiding another app's window needs the accessibility permission), and it is not kept on top: put it where you like and the browser remembers.

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
