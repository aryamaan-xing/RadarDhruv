export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>This page didn't load</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font: 15px/1.5 system-ui, -apple-system, sans-serif; background: #050805; color: #d7ffe4; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 1.5rem; }
      .card { max-width: 28rem; width: 100%; text-align: center; padding: 2rem; border: 1px solid #1f6b3a; background: #02100a; }
      h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
      p { color: #7fb992; margin: 0 0 1.5rem; }
      a, button { padding: 0.5rem 1rem; border-radius: 0.25rem; font: inherit; cursor: pointer; text-decoration: none; border: 1px solid #1f6b3a; background: #04200f; color: #d7ffe4; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>This page didn't load</h1>
      <p>The trainer encountered an error. Try refreshing or return home.</p>
      <button onclick="location.reload()">Try again</button>
      <a href="/">Go home</a>
    </div>
  </body>
</html>`;
}
