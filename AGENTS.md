# Project Instructions

## I18n Rule

- All user-facing text must use the i18n system.
- Do not add hardcoded labels, button text, hints, alerts, tooltips, aria labels, dialog text, status text, or shortcut descriptions directly into renderer or main-process code unless there is a temporary fallback.
- For every new user-visible string:
  - Add a translation key in `src/locales/tr.json`.
  - Add the same key to every other active locale file in `src/locales/` (`en.json`, `de.json`, `es.json`, `fr.json`).
  - Prefer meaningful nested keys under the relevant feature namespace, such as `recording_wizard.step3.add_window`.
- In HTML, prefer `data-i18n`, `data-i18n-aria`, `data-i18n-placeholder`, or `data-i18n-html`.
- In JavaScript, use the existing translation helper instead of hardcoded strings.
- If a fallback string is temporarily necessary during development, it must be replaced with a locale key before the task is considered complete.

## Done Criteria

- A feature is not complete until its new user-visible text exists in all locale files and the UI uses those keys.

## Release Metadata Rule

- Release publishing files such as `update.json`, `website/update.json`, and `website/releases.json` are user-facing and must preserve natural Turkish text with proper diacritics.
- Do not replace Turkish characters with ASCII fallbacks such as `guncelleme`, `surum`, `cikti`, or `saga-sola`.
- When editing release notes or website metadata, save the files as UTF-8 and verify the Turkish text still appears correctly after the edit.

## Keyboard Manager Rule

- When adding a new user-triggerable feature, command, wizard action, preset, or global shortcut, also evaluate whether it should be exposed in the keyboard shortcut manager.
- If the new functionality can reasonably benefit from a custom shortcut, add it to the keyboard manager and localize its category and action label in all active locale files.
- If a feature intentionally should not appear in the keyboard manager, document that decision in the implementation notes or code comments near the related shortcut handling.

## Accessibility Rule

- Form controls must have an explicit accessible name that screen readers announce clearly during keyboard navigation.
- Prefer a real label association first (`label for` / matching `id`); add `aria-label` when the tab order or repeated dynamic fields would otherwise sound ambiguous.
- For repeated controls such as slot lists, include enough context in the accessible name for the user to distinguish items quickly, such as the slot number plus the field label.
