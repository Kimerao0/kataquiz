import { fireEvent, render } from '@testing-library/react'
import { QuestionCode, QuestionImage } from './question-media'

// The image has alt="", which makes it presentational, so getByRole('img')
// never finds it. Every query below goes by tag and src on purpose; do not
// "fix" them into role queries, or the presence tests would pass vacuously.
function imageIn(container: HTMLElement) {
  return container.querySelector('img')
}

describe('QuestionImage', () => {
  it('renders an https image with the src it was given', () => {
    const src = 'https://cdn.example.com/diagrams/a.png'
    const { container } = render(<QuestionImage src={src} />)

    // The baseline: if the guard rejected everything, every other test in this
    // block that expects nothing would pass for the wrong reason.
    expect(container.querySelector(`img[src="${src}"]`)).toBeInTheDocument()
  })

  it('renders a plain http image too', () => {
    const src = 'http://cdn.example.com/diagrams/a.png'
    const { container } = render(<QuestionImage src={src} />)

    // Plain http is allowed on purpose. A test that only proved https would
    // pass against a guard that wrongly narrowed the allow-list to https.
    expect(container.querySelector(`img[src="${src}"]`)).toBeInTheDocument()
  })

  it('renders nothing for a javascript: src', () => {
    const { container } = render(<QuestionImage src="javascript:alert(1)" />)

    // Quiz content comes from strangers; a script scheme must never reach the DOM.
    expect(imageIn(container)).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a data: src', () => {
    const { container } = render(<QuestionImage src="data:image/svg+xml,<svg></svg>" />)

    // Not an XSS vector: SVG inside <img> is a non-scripted context. What data:
    // buys an author is an inline payload that bypasses any host-based img-src
    // policy and can be arbitrarily large, so it stays out with the rest of the
    // non-http(s) schemes.
    expect(imageIn(container)).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the normalised form of the URL, not the raw one', () => {
    const { container } = render(<QuestionImage src="https://CDN.Example.com:443/a.png" />)

    // Host case-folding and default-port removal are what new URL does. Worth
    // pinning because it is the one DOM-observable consequence of the guard:
    // every other URL in this file is already a normalisation fixed point, so
    // reverting src={safe} to src={src} would leave the rest of the suite green.
    expect(container.querySelector('img[src="https://cdn.example.com/a.png"]')).toBeInTheDocument()
  })

  it('renders nothing for a relative path', () => {
    const { container } = render(<QuestionImage src="/uploads/diagram.png" />)

    // new URL cannot parse a relative path without a base. Pinned because it is
    // the case most likely to surprise someone later: it looks harmless, but
    // the column is meant to hold absolute external URLs only.
    expect(imageIn(container)).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('removes the image when it fails to load', () => {
    const { container } = render(<QuestionImage src="https://cdn.example.com/missing.png" />)
    const image = imageIn(container)
    expect(image).toBeInTheDocument()

    fireEvent.error(image as HTMLImageElement)

    // A broken file must vanish instead of leaving a torn frame. The guard sits
    // next to this logic, so this is the check that it did not displace it.
    expect(imageIn(container)).toBeNull()
  })
})

describe('QuestionCode', () => {
  it('renders the snippet and its language label', () => {
    const code = 'const answer = 42'
    const { container } = render(<QuestionCode code={code} language="typescript" />)

    // The snippet is author-supplied and must come out as text inside the block,
    // and the label tells the reader what they are looking at.
    expect(container.querySelector('pre code')).toHaveTextContent(code)
    expect(container).toHaveTextContent('typescript')
  })

  it('renders no label when the language is null', () => {
    const { container } = render(<QuestionCode code="echo hi" language={null} />)

    // A null language must not leave an empty or literal "null" label above the
    // block. The snippet still renders, so the absence is the label's alone.
    expect(container.querySelector('pre code')).toHaveTextContent('echo hi')
    expect(container.querySelector('p')).toBeNull()
    expect(container).not.toHaveTextContent('null')
  })

  it('keeps a snippet containing markup as text', () => {
    const code = '<b>x</b>'
    const { container } = render(<QuestionCode code={code} language={null} />)

    // A deliberate-change guard, not a bug hunt: React makes this regression
    // unlikely rather than impossible, and the component states the property
    // ("stays text"). Switching to dangerouslySetInnerHTML would turn the tag
    // into an element, which a markup-free snippet could never reveal.
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('pre code')).toHaveTextContent(code)
  })

  it('makes the scrolling block reachable by keyboard', () => {
    const { container } = render(<QuestionCode code="echo hi" language={null} />)

    // The tabIndex sits under a biome-ignore (WCAG 2.1.1: a region that scrolls
    // sideways must be focusable). Because the rule is suppressed, no linter
    // will object if a cleanup deletes the attribute along with its now-dangling
    // ignore; this test is the only thing that notices.
    expect(container.querySelector('pre')).toHaveAttribute('tabindex', '0')
  })
})
