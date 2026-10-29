import { render, screen } from '@testing-library/react'
import { CheckIcon, TimerOffIcon, XIcon } from 'lucide-react'
import type { AnswerResult } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { Explanation, TheoryLink, verdictFor } from './feedback-parts'

// Only the two flags drive the verdict; the rest is filler to satisfy the type.
function resultWith(flags: { correct: boolean; timedOut: boolean }): AnswerResult {
  return {
    ...flags,
    correctOptionIds: [],
    explanation: null,
    theoryUrl: null,
    next: null,
    summary: null,
  }
}

describe('TheoryLink', () => {
  it('renders an https url as a link that cannot reach back to the opener', () => {
    renderWithMessages(<TheoryLink url="https://example.com/theory.html" />)

    const link = screen.getByRole('link', { name: 'Read the theory' })

    // The baseline: if the guard rejected everything, every "renders nothing"
    // test below would pass for the wrong reason. The rel is pinned because it is
    // what stops the destination getting a handle on window.opener, and nothing
    // else in the suite would notice it being dropped.
    expect(link).toHaveAttribute('href', 'https://example.com/theory.html')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer noopener')
  })

  it('renders a plain http url too', () => {
    renderWithMessages(<TheoryLink url="http://example.com/theory.html" />)

    // Plain http is allowed on purpose. A test that only proved https would pass
    // against a guard wrongly narrowed to it.
    expect(screen.getByRole('link', { name: 'Read the theory' })).toHaveAttribute(
      'href',
      'http://example.com/theory.html',
    )
  })

  it('renders nothing for null', () => {
    const { container } = renderWithMessages(<TheoryLink url={null} />)

    // The prop change that let both call sites drop their conditional. If null
    // threw or left an empty anchor, those call sites would now be broken.
    expect(screen.queryByRole('link')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a javascript: url', () => {
    const { container } = renderWithMessages(<TheoryLink url="javascript:alert(1)" />)

    // The case that matters: unlike in an <img src>, a javascript: href executes
    // on click, in the player's session. Quiz content comes from strangers.
    expect(container.querySelector('a')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a data: url', () => {
    const { container } = renderWithMessages(<TheoryLink url="data:text/html,<b>x</b>" />)

    // Not an http(s) page the author can be held to; navigating to a data: URL
    // would put author-supplied markup in front of the player.
    expect(container.querySelector('a')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a relative path', () => {
    const { container } = renderWithMessages(<TheoryLink url="/uploads/theory.html" />)

    // new URL cannot parse a relative path without a base, so this exercises the
    // catch branch rather than the protocol comparison. It looks harmless, but
    // the column is meant to hold absolute external URLs only.
    expect(container.querySelector('a')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the normalised form of the url, not the raw one', () => {
    renderWithMessages(<TheoryLink url="https://EXAMPLE.com:443/theory.html" />)

    // Host case-folding and default-port removal are what new URL does. Every
    // other url here is already a normalisation fixed point, so rendering the
    // raw prop instead of the checked value would leave the rest of the suite green.
    expect(screen.getByRole('link', { name: 'Read the theory' })).toHaveAttribute(
      'href',
      'https://example.com/theory.html',
    )
  })
})

describe('verdictFor', () => {
  it('gives the correct verdict for a correct answer', () => {
    // Swapping the correct and wrong keys would show every player the wrong word.
    expect(verdictFor(resultWith({ correct: true, timedOut: false })).key).toBe('feedbackCorrect')
  })

  it('gives the wrong verdict for a wrong answer', () => {
    expect(verdictFor(resultWith({ correct: false, timedOut: false })).key).toBe('feedbackWrong')
  })

  it('gives the timeout verdict for a timed-out answer', () => {
    // Saying only "wrong" would hide why; the third verdict exists for this.
    expect(verdictFor(resultWith({ correct: false, timedOut: true })).key).toBe('feedbackTimedOut')
  })

  it('gives the timeout verdict when the result is both timed out and correct', () => {
    // Running out of time is wrong whatever was selected. The timeout branch
    // being checked first is the only ordering in the function that could
    // silently invert, and no other input distinguishes it.
    expect(verdictFor(resultWith({ correct: true, timedOut: true })).key).toBe('feedbackTimedOut')
  })

  it('gives correct and wrong different tones', () => {
    const correct = verdictFor(resultWith({ correct: true, timedOut: false }))
    const wrong = verdictFor(resultWith({ correct: false, timedOut: false }))

    // The panel renders a mark and a word so the verdict never rests on colour
    // alone, but the colour half must still tell the two apart: if both shared a
    // tone, a right answer would read as a failure at a glance.
    expect(correct.tone).not.toBe(wrong.tone)
  })

  it('shares one tone between wrong and timed out, on purpose', () => {
    const wrong = verdictFor(resultWith({ correct: false, timedOut: false }))
    const timedOut = verdictFor(resultWith({ correct: false, timedOut: true }))

    // Running out of time is a failure, so it is meant to read like one. Without
    // this the sharing looks like a coincidence someone could "fix" unnoticed.
    expect(timedOut.tone).toBe(wrong.tone)
  })

  it('pairs each verdict with its own mark', () => {
    // The icon is aria-hidden wherever it renders, so it has no accessible name
    // and no text query can reach it. Identity against the imported component is
    // the only assertion available. It must be identity, not "the icons differ":
    // swapping the check and the cross would still differ, and would put a cross
    // beside the word "Correct". "A mark and a word, never colour alone" only
    // holds if the mark is the right one.
    expect(verdictFor(resultWith({ correct: true, timedOut: false })).Icon).toBe(CheckIcon)
    expect(verdictFor(resultWith({ correct: false, timedOut: false })).Icon).toBe(XIcon)
    expect(verdictFor(resultWith({ correct: false, timedOut: true })).Icon).toBe(TimerOffIcon)
  })
})

describe('Explanation', () => {
  it('renders its value as text', () => {
    const { container } = render(<Explanation value="Because the loop is O(n)." />)

    // The explanation is the one thing on the screen that is read; losing it
    // would leave the verdict with no reason.
    expect(container.querySelector('p')).toHaveTextContent('Because the loop is O(n).')
  })

  it('renders a value containing markup as text, not markup', () => {
    const value = '<img src=x onerror=alert(1)><b>bold</b>'
    const { container } = render(<Explanation value={value} />)

    // Explanations are uploaded by strangers and go through QuizText. A switch to
    // innerHTML anywhere on that path would turn these tags into elements, which
    // plain prose could never reveal.
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    expect(container.querySelector('p')).toHaveTextContent(value)
  })
})
