# Deploying

The host serves plain files. A deploy copies `out/` into the subdomain root and nothing else —
`api/`, `uploads/` and the `.htaccess` files must survive it.

```
pnpm build
rsync -az --delete --exclude api/ --exclude uploads/ --exclude .htaccess \
  -e "ssh -p 65002 -i ~/.ssh/hostinger_ed25519" \
  out/ areagles:domains/areagles.com/public_html/sys/
```

`--delete` without those excludes would take the backend with it.

`deploy/htaccess` is the subdomain's `.htaccess`: security headers, the API rewrite, the
page-shell rule with its -f test, and a real 404. Copy it up when it changes.
