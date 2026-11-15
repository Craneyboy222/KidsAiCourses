# Dependencies

One line per dependency added after the scaffold: name, purpose, licence.

- `axe-core` (dev): automated accessibility checks on composed UI kit examples in unit tests (`tests/unit/ui/axe.test.tsx`). Already in the lockfile through `@axe-core/playwright`; now a direct dev dependency so tests can import it. Licence: MPL-2.0.
- Bundled data, not a package: `src/server/auth/common-passwords.ts` holds 9,113 common passwords of ten or more characters, used to refuse weak passwords (spec 3.1, decision D10). Source: the UK National Cyber Security Centre's top-100,000 password list as redistributed in the SecLists project (`Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt`). Licence: MIT (SecLists). No new npm dependency was added for the database or authentication work.
