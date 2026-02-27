# Smart Diff

Smart Diff compares Python method changes in GitHub pull requests using Tree-sitter AST parsing.

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
npx sv create --template minimal --types ts --install npm detective
```

## Developing

Once you've installed dependencies, start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open

## Systemd service (Multipass VM)

Install the service unit and start it (runs `npm run build` then `npm run preview` on port 3000):

```bash
sudo cp ./deploy/detective.service /etc/systemd/system/detective.service
sudo systemctl daemon-reload
sudo systemctl enable --now detective.service
```

### GitHub token

To avoid GitHub rate limits, create `/etc/default/detective` with a token:

```bash
echo 'GITHUB_TOKEN=ghp_your_token_here' | sudo tee /etc/default/detective
sudo systemctl restart detective.service
```

Check status/logs:

```bash
sudo systemctl status detective.service
journalctl -u detective.service -f
```

To stop or restart:

```bash
sudo systemctl stop detective.service
sudo systemctl restart detective.service
```

## Smart diff flow

1. Start the dev server and open the app.
2. Paste a public GitHub PR URL.
3. Review the "Smart Method Diff" tab for AST-based changes or switch to the standard patch tab.

### AST smoke test

Run the AST smoke script to sanity-check Tree-sitter parsing:

```sh
npm run smoke:ast
```
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.
