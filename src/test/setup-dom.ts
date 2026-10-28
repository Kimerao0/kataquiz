// Registers the DOM matchers (toBeDisabled, toHaveAccessibleName, …) on the
// `expect` of the jsdom project. Loaded only there; node tests never see it.
import '@testing-library/jest-dom/vitest'
