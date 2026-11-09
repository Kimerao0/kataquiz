import { mistakesExportFilename } from './filename'

const now = new Date('2026-11-03T22:15:00Z')

describe('mistakesExportFilename', () => {
  it('names an unfiltered export after the date alone', () => {
    expect(mistakesExportFilename(null, now)).toBe('kataquiz-mistakes-2026-11-03.json')
  })

  it('puts the tag between the prefix and the date', () => {
    expect(mistakesExportFilename('aws', now)).toBe('kataquiz-mistakes-aws-2026-11-03.json')
  })

  it('reduces a tag to characters safe in a header', () => {
    expect(mistakesExportFilename('Città "AWS"/S3; x', now)).toBe(
      'kataquiz-mistakes-citta-aws-s3-x-2026-11-03.json',
    )
  })

  it('drops a tag that reduces to nothing', () => {
    expect(mistakesExportFilename('!!!', now)).toBe('kataquiz-mistakes-2026-11-03.json')
  })

  it('uses the UTC date', () => {
    const lateEvening = new Date('2026-11-03T23:30:00-05:00')

    expect(mistakesExportFilename(null, lateEvening)).toBe('kataquiz-mistakes-2026-11-04.json')
  })
})
