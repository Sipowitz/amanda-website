# Apple Pay domain verification

Place the genuine, current Square-provided `apple-developer-merchantid-domain-association` file in this directory before registering the domain in Square:

`public/.well-known/apple-developer-merchantid-domain-association`

Do not replace it with a generated or placeholder file. Vite copies this directory unchanged, so Cloudflare Pages will publish it at `/.well-known/apple-developer-merchantid-domain-association`. Verify the deployed response is the exact file, not a redirect or the React application.
