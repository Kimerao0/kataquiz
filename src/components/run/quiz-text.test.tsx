import { render, screen } from '@testing-library/react'
import { QuizText } from './quiz-text'

// The segmenting rule itself is covered next to where it lives, in
// src/lib/quiz-schema/inline-code.test.ts. This is only about what the run
// screen paints with it, and about the one thing that must never happen.
describe('QuizText', () => {
  it('renders a payload as characters and never as markup', () => {
    const hostile = '<script>alert(1)</script> Which sign?'
    const { container } = render(<QuizText value={hostile} />)

    expect(container.querySelector('script')).toBeNull()
    expect(container).toHaveTextContent('<script>alert(1)</script>', {
      normalizeWhitespace: false,
    })
  })

  it('does not treat a backticked run as a way to smuggle an element in', () => {
    const { container } = render(<QuizText value="say `<b>hi</b>` please" />)

    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>hi</b>').tagName).toBe('CODE')
  })

  it('sets a backticked run as code and leaves the prose around it alone', () => {
    const { container } = render(<QuizText value="`typeof x` narrows a union" />)

    expect(screen.getByText('typeof x').tagName).toBe('CODE')
    expect(container).toHaveTextContent('typeof x narrows a union')
  })

  it('leaves an unpaired backtick as the character the author typed', () => {
    const { container } = render(<QuizText value="a ` b" />)

    expect(container.querySelector('code')).toBeNull()
    expect(container).toHaveTextContent('a ` b')
  })
})
