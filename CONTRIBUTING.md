# Contributing

Thanks for your interest in `medusa-plugin-pennylane`.

## This project does not accept pull requests

Contributions are welcome **through GitHub Issues only**:

- **Bug reports** — [open a bug report](https://github.com/pierre-b/medusa-pennylane/issues/new?template=bug_report.md)
- **Feature requests** — [open a feature request](https://github.com/pierre-b/medusa-pennylane/issues/new?template=feature_request.md)

Pull requests opened from outside the maintainer team will be closed. This keeps the scope, code style, and release cadence coherent with how the plugin is actually used in production.

If you have a patch or a specific code change in mind, please describe it in an issue (what you'd change, and why). The maintainer will evaluate, implement, and release it — with credit to the reporter in the CHANGELOG when appropriate.

## Filing a good issue

### Bug report

Include:

- Plugin version, Medusa version, Node version, OS
- A minimal reproduction: `medusa-config.ts` plugin snippet, relevant product metadata, redacted logs
- Expected vs actual behavior

### Feature request

Include:

- The problem you're trying to solve (not only the solution you imagine)
- Whether the feature is within scope: Medusa ↔ Pennylane invoice sync, no host-app-specific assumptions, compatible with per-product `metadata.pennylane_vat_rate` VAT convention
- Alternatives you've considered

### Security issues

Do **not** open a public issue. File a [private security advisory](https://github.com/pierre-b/medusa-pennylane/security/advisories/new) instead. See [SECURITY.md](SECURITY.md).

## Code of Conduct

By participating in this project (filing issues, commenting, etc.), you agree to abide by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

This project is Apache-2.0 licensed. Any text or reproductions you include in issues are assumed to be shareable under the same license.
