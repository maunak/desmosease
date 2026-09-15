import { freqToNote, toneFreq } from '../lib/math'

type Props = {
  selected: number[]
  onToggle: (note: number) => void
}

const START = -21
const KEYS = 25

function isBlack(semitoneFromC: number): boolean {
  const pc = ((semitoneFromC % 12) + 12) % 12
  return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10
}

export function Piano({ selected, onToggle }: Props) {
  const white: number[] = []
  const black: number[] = []
  for (let i = 0; i < KEYS; i++) {
    const note = START + i
    const fromC = note + 9
    if (isBlack(fromC)) black.push(note)
    else white.push(note)
  }

  return (
    <div className="piano" role="group" aria-label="Piano">
      <div className="piano-whites">
        {white.map((note) => {
          const name = freqToNote(toneFreq(note))
          const showOctave = name.startsWith('C')
          return (
            <button
              key={note}
              type="button"
              className={`piano-key white ${selected.includes(note) ? 'on' : ''}`}
              title={name}
              onClick={() => onToggle(note)}
            >
              <span>{showOctave ? name : name.replace(/\d+$/, '')}</span>
            </button>
          )
        })}
      </div>
      <div className="piano-blacks">
        {black.map((note) => {
          const fromC = note + 9
          const whitesBefore = white.filter((w) => w + 9 < fromC).length
          const name = freqToNote(toneFreq(note))
          return (
            <button
              key={note}
              type="button"
              className={`piano-key black ${selected.includes(note) ? 'on' : ''}`}
              title={name}
              style={{ left: `${(whitesBefore - 0.38) * (100 / white.length)}%` }}
              onClick={() => onToggle(note)}
            />
          )
        })}
      </div>
    </div>
  )
}
