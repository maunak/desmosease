type Props = {
  onOpenApp: () => void
}

export function About({ onOpenApp }: Props) {
  return (
    <main className="about">
      <div className="about-inner">
        <p className="about-kicker">A short guide</p>
        <h2>Type math. See a picture. Hear it play.</h2>
        <p className="about-lead">
          dmos is a graphing calculator with speakers. You write the same kind of math you would write in
          Desmos. The picture on the right is the graph. Hit play, and that picture becomes sound.
        </p>
        <p>
          <button type="button" className="about-cta" onClick={onOpenApp}>
            Open the calculator
          </button>
        </p>

        <section>
          <h3>What is Desmos?</h3>
          <p>
            <a href="https://www.desmos.com/calculator" target="_blank" rel="noreferrer">
              Desmos
            </a>{' '}
            is a free graphing calculator in the browser. You type something like <code>y = sin(x)</code>, and it
            draws the wave. Schools use it in math class because you can see what an equation looks like
            instantly.
          </p>
          <p>
            Some people also use Desmos to make music. They write waves, stacks of notes, and little lists of
            pitches, then ask Desmos to turn that into sound. dmos is built for that idea: the equation is
            both the drawing and the song.
          </p>
        </section>

        <section>
          <h3>What this app is</h3>
          <p>
            Left side: a list of rows. Each row is one equation, or a list of notes. Right side: a white graph,
            like Desmos. Play reads those rows and makes sound. Nothing is a pre-recorded song — what you
            wrote is what you hear.
          </p>
        </section>

        <section>
          <h3>Try it in five steps</h3>
          <ol className="about-steps">
            <li>
              <strong>Look at the first row.</strong> It should say something like <code>sin(x - t)</code>. That is
              a wave. The <code>t</code> is a clock, so the wave slides when sound is on.
            </li>
            <li>
              <strong>Press Play</strong> (or the space bar). You should hear a steady tone, and the wave should
              start moving. Press Stop, and the picture freezes. If nothing is playing, the graph should sit
              still.
            </li>
            <li>
              <strong>Tap the piano</strong> under the list. Keys write math for you — a chord becomes a sum of
              waves, and you see those waves on the graph.
            </li>
            <li>
              <strong>Use Rate.</strong> <code>2×</code> makes that row run faster. The picture scrolls faster
              and the pitch goes up by an octave (the same note, but higher). <code>½×</code> does the
              opposite.
            </li>
            <li>
              <strong>Load a song.</strong> On the left, under Songs, press ▶ next to <em>Boring Stuff</em> or{' '}
              <em>Small hours</em>. That fills the list and plays it. Press Stop whenever you want.
            </li>
          </ol>
        </section>

        <section>
          <h3>Two kinds of rows</h3>
          <p>
            <strong>In turn</strong> means “play me, then play the next one.” That is how a chord progression
            walks forward.
          </p>
          <p>
            <strong>Hold</strong> means “keep sounding under everything else.” That is a bass note that stays
            put while chords change on top.
          </p>
          <p>
            A row that only names something, like <code>A = C4 E4 G4</code>, is a label. It does not make sound
            by itself. Write <code>tone(A)</code> on another row to play that list.
          </p>
        </section>

        <section>
          <h3>Words, in plain language</h3>
          <dl className="about-glossary">
            <div>
              <dt>Equation</dt>
              <dd>The math you type in a row. Example: <code>sin(x - t)</code>.</dd>
            </div>
            <div>
              <dt>Graph</dt>
              <dd>The picture of that math on the white grid.</dd>
            </div>
            <div>
              <dt>t (the clock)</dt>
              <dd>
                Time. It only moves while sound is on. If your equation has no <code>t</code>, the picture
                stays still even when you hear something.
              </dd>
            </div>
            <div>
              <dt>Note / pitch</dt>
              <dd>How high or low a sound is. A4 is the “la” most instruments tune to (440 Hz).</dd>
            </div>
            <div>
              <dt>Chord</dt>
              <dd>Several notes at once. The piano builds these. They show up as stacked waves.</dd>
            </div>
            <div>
              <dt>tone(…)</dt>
              <dd>
                “Play this.” <code>tone(A4)</code> is a note name. <code>tone(440)</code> is a frequency in
                hertz. <code>tone(A)</code> plays a list you named <code>A</code>.
              </dd>
            </div>
            <div>
              <dt>List</dt>
              <dd>
                A named pile of notes, like <code>A = C4 E4 G4</code>. Other rows can point at it.
              </dd>
            </div>
            <div>
              <dt>Rate</dt>
              <dd>
                How fast this row runs. It speeds up the drawing and raises the pitch by the same amount.
              </dd>
            </div>
            <div>
              <dt>Beats</dt>
              <dd>How long a row waits before the next “in turn” row starts. Tied to the tempo slider.</dd>
            </div>
            <div>
              <dt>Tempo (BPM)</dt>
              <dd>How fast the whole song walks. Higher BPM = shorter waits between chords.</dd>
            </div>
            <div>
              <dt>Sound menu (Pad / Soft / Reed / Bright)</dt>
              <dd>The color of the instrument — warm, round, reedy, or sharper — not the notes themselves.</dd>
            </div>
            <div>
              <dt>MIDI file</dt>
              <dd>
                A file that says which notes happen when. Drop a <code>.mid</code> onto this app (not onto an
                empty browser tab).
              </dd>
            </div>
            <div>
              <dt>Hz (hertz)</dt>
              <dd>How many times the wave repeats each second. 440 Hz is A4.</dd>
            </div>
          </dl>
        </section>

        <section>
          <h3>Handy keys</h3>
          <ul>
            <li>
              <kbd>space</kbd> play or stop (not while you are typing in a box)
            </li>
            <li>
              <kbd>esc</kbd> stop
            </li>
            <li>Drag the graph to pan, scroll to zoom, Home to reset the view</li>
            <li>
              <code>t = 0</code> on the graph sends the clock back to the start
            </li>
          </ul>
        </section>

        <p>
          <button type="button" className="about-cta" onClick={onOpenApp}>
            Open the calculator
          </button>
        </p>
      </div>
    </main>
  )
}
