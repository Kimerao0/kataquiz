import { screen, within } from '@testing-library/react'
import type { AnswerResult, PublicQuestion } from '@/lib/run/service'
import { renderWithMessages } from '@/test/intl'
import { type Reviewed, RunReview } from './run-review'

function questionOf(id: string, prompt: string, optionTexts: [string, string]): PublicQuestion {
  return {
    id,
    type: 'single',
    prompt,
    imageUrl: null,
    code: null,
    codeLanguage: null,
    options: [
      { id: `${id}-a`, text: optionTexts[0] },
      { id: `${id}-b`, text: optionTexts[1] },
    ],
  }
}

function resultOf(overrides: Partial<AnswerResult> = {}): AnswerResult {
  return {
    correct: true,
    timedOut: false,
    correctOptionIds: [],
    explanation: null,
    theoryUrl: null,
    next: null,
    summary: null,
    ...overrides,
  }
}

const hit: Reviewed = {
  question: questionOf('q1', 'What does a red triangular sign mean?', ['Warning', 'Prohibition']),
  selectedOptionIds: ['q1-a'],
  result: resultOf({ correct: true, correctOptionIds: ['q1-a'], explanation: 'Triangles warn.' }),
}

const miss: Reviewed = {
  question: questionOf('q2', 'What colour is a stop sign?', ['Red', 'Blue']),
  selectedOptionIds: ['q2-b'],
  result: resultOf({
    correct: false,
    correctOptionIds: ['q2-a'],
    explanation: 'Stop signs are red so they read at a distance.',
  }),
}

const timedOut: Reviewed = {
  question: questionOf('q3', 'Which side do you overtake on?', ['Left', 'Right']),
  selectedOptionIds: [],
  result: resultOf({ correct: false, timedOut: true, correctOptionIds: ['q3-a'] }),
}

// The disclosure is the <details> that owns the prompt, so that is where the
// open state is read from.
function entryOf(prompt: string) {
  const entry = screen.getByText(prompt).closest('details')
  if (!entry) throw new Error(`no review entry for ${prompt}`)
  return entry
}

describe('run review', () => {
  it('opens a missed entry and leaves a correct one shut', () => {
    renderWithMessages(<RunReview items={[hit, miss]} />)

    expect(entryOf(miss.question.prompt)).toHaveAttribute('open')
    expect(entryOf(hit.question.prompt)).not.toHaveAttribute('open')
    // Visibility as well as the attribute: the point is what the player can
    // read without clicking, and a shut entry hides its explanation.
    expect(screen.getByText(miss.result.explanation as string)).toBeVisible()
    expect(screen.getByText(hit.result.explanation as string)).not.toBeVisible()
  })

  it('opens a timed-out entry, since running out of time is a miss', () => {
    renderWithMessages(<RunReview items={[timedOut]} />)

    expect(entryOf(timedOut.question.prompt)).toHaveAttribute('open')
  })

  it('names all three verdicts in words', () => {
    renderWithMessages(<RunReview items={[hit, miss, timedOut]} />)

    const [first, second, third] = screen.getAllByRole('listitem')
    // Each verdict is checked inside its own entry, so a verdict that was
    // rendered for the wrong question cannot pass by being somewhere on screen.
    expect(within(first).getByText('Correct')).toBeInTheDocument()
    expect(within(second).getByText('Wrong')).toBeInTheDocument()
    expect(within(third).getByText('Out of time')).toBeInTheDocument()
    // A timeout is its own verdict and not also "Wrong".
    expect(within(third).queryByText('Wrong')).not.toBeInTheDocument()
  })

  it('renders the explanation of a missed entry', () => {
    renderWithMessages(<RunReview items={[miss]} />)

    expect(screen.getByText('Stop signs are red so they read at a distance.')).toBeVisible()
  })

  it('renders the prompt of every entry, in the order played', () => {
    renderWithMessages(<RunReview items={[hit, miss, timedOut]} />)

    const entries = screen.getAllByRole('listitem')
    expect(entries).toHaveLength(3)
    expect(within(entries[0]).getByText(hit.question.prompt)).toBeInTheDocument()
    expect(within(entries[1]).getByText(miss.question.prompt)).toBeInTheDocument()
    expect(within(entries[2]).getByText(timedOut.question.prompt)).toBeInTheDocument()
  })

  it('shows what was picked and what was right for a wrong answer', () => {
    renderWithMessages(<RunReview items={[miss]} />)

    // Both blocks, each with its own option: the pick is the wrong one and the
    // correct answer is the other, so swapping the two would fail.
    const picked = screen.getByText('Your answer').parentElement as HTMLElement
    const right = screen.getByText('Correct answer').parentElement as HTMLElement
    expect(within(picked).getByText('Blue')).toBeInTheDocument()
    expect(within(picked).queryByText('Red')).not.toBeInTheDocument()
    expect(within(right).getByText('Red')).toBeInTheDocument()
    expect(within(right).queryByText('Blue')).not.toBeInTheDocument()
  })

  it('shows no "Your answer" block for a correct entry', () => {
    renderWithMessages(<RunReview items={[hit]} />)

    // Restating the pick under a second label says nothing on a hit. The
    // entry is shut, so the text is checked in the document, not by visibility.
    expect(screen.getByText('Correct answer')).toBeInTheDocument()
    expect(screen.queryByText('Your answer')).not.toBeInTheDocument()
  })

  it('shows the correct answer and no "Your answer" block when time ran out with nothing selected', () => {
    renderWithMessages(<RunReview items={[timedOut]} />)

    const right = screen.getByText('Correct answer').parentElement as HTMLElement
    expect(within(right).getByText('Left')).toBeVisible()
    expect(screen.queryByText('Your answer')).not.toBeInTheDocument()
  })

  it('renders no theory link for a javascript: url', () => {
    const hostile: Reviewed = {
      ...miss,
      result: { ...miss.result, theoryUrl: 'javascript:alert(1)' },
    }
    renderWithMessages(<RunReview items={[hostile]} />)

    // The entry itself is open and rendered, so the absence is the filter's
    // doing and not an entry that failed to mount.
    expect(screen.getByText(miss.result.explanation as string)).toBeVisible()
    expect(screen.queryByRole('link', { name: 'Read the theory' })).not.toBeInTheDocument()
  })

  it('renders a theory link for an https: url', () => {
    const linked: Reviewed = {
      ...miss,
      result: { ...miss.result, theoryUrl: 'https://example.com/signs' },
    }
    renderWithMessages(<RunReview items={[linked]} />)

    expect(screen.getByRole('link', { name: 'Read the theory' })).toHaveAttribute(
      'href',
      'https://example.com/signs',
    )
  })

  it('renders the snippet and its language for a missed code question', () => {
    const snippet = 'const x = [1, 2] as const'
    const withCode: Reviewed = {
      ...miss,
      question: { ...miss.question, code: snippet, codeLanguage: 'typescript' },
    }
    renderWithMessages(<RunReview items={[withCode]} />)

    // The snippet is read from inside the <pre>, so a prompt that merely
    // mentions the code cannot satisfy it. The label is read from the same
    // wrapper: the language belongs to this snippet, not to somewhere else.
    const block = entryOf(withCode.question.prompt).querySelector('pre')
    expect(block).toBeVisible()
    expect(block).toHaveTextContent(snippet)
    expect(within(block?.parentElement as HTMLElement).getByText('typescript')).toBeVisible()
  })

  it('renders the snippet and no language label when the code has no language', () => {
    const snippet = 'const x = [1, 2] as const'
    const withCode: Reviewed = {
      ...miss,
      question: { ...miss.question, code: snippet, codeLanguage: null },
    }
    renderWithMessages(<RunReview items={[withCode]} />)

    // The snippet must still be there, otherwise "no label" would also pass
    // for an entry that dropped the whole block. The label is the only <p> in
    // the block, so a stray "null" or empty tag shows up as one.
    const block = entryOf(withCode.question.prompt).querySelector('pre')
    expect(block).toHaveTextContent(snippet)
    const wrapper = block?.parentElement
    if (!wrapper) throw new Error('the code block has no wrapper to look in')
    expect(wrapper.querySelector('p')).toBeNull()
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('renders the image of a missed image question', () => {
    const src = 'https://example.com/sign.png'
    const withImage: Reviewed = {
      ...miss,
      question: { ...miss.question, imageUrl: src },
    }
    renderWithMessages(<RunReview items={[withImage]} />)

    // Queried by tag and src on purpose: the image has alt="" (the prompt
    // carries the meaning), which makes it presentational, so getByRole('img')
    // never finds it. Do not "fix" this into a role query.
    const image = entryOf(withImage.question.prompt).querySelector(`img[src="${src}"]`)
    expect(image).toBeInTheDocument()
    expect(image).toBeVisible()
  })

  it('renders no code block and no image for a question that has neither', () => {
    renderWithMessages(<RunReview items={[miss]} />)

    // The entry is open and its body is on screen, so the absence is the
    // component's doing and not a body that failed to mount. This is the guard
    // against "always render an empty code block".
    const entry = entryOf(miss.question.prompt)
    expect(screen.getByText(miss.result.explanation as string)).toBeVisible()
    expect(entry.querySelector('pre')).toBeNull()
    expect(entry.querySelector('img')).toBeNull()
  })
})
