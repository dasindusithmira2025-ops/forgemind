/**
 * Brain Ask: the flagship surface.
 *
 * A question about the project, answered from what the project has actually learned. The answer is
 * composed deterministically by the backend from real stored rows — memories, claims, evidence,
 * agent handoffs, the timeline — and never by a model, which is why this surface says so out loud
 * rather than letting the prose imply otherwise.
 *
 * The layout follows the shape of a defensible answer: what was asked, what Brain believes, what
 * that rests on, what is adjacent, and how it got here. A user who does not trust the answer can
 * click straight through to the evidence, which is the only thing that makes an answer worth
 * having.
 */
import { useEffect, useRef, type FormEvent } from 'react'
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  History,
  Link2,
  Search,
  Sparkles,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { ErrorNotice } from '../../../components/ui/ErrorNotice'
import { useBrainStore } from '../brainStore'
import { useMemoryStore } from '../memoryStore'
import { BRAIN_INTENT_LABELS, type BrainSource } from '../brainTypes'
import { TIMELINE_LABELS } from '../intelligenceTypes'
import { relativeAge } from '../memoryPresentation'

/**
 * Questions that are worth asking a project that has knowledge in it.
 *
 * Deliberately phrased as the questions themselves rather than as capabilities, and shown only
 * when nothing has been asked yet. These run — they are not a feature list.
 */
const OPENERS = [
  'What is this project?',
  'What changed this week?',
  'What decisions are still active?',
  'What did we try before?',
]

function SourceRow({ source }: { source: BrainSource }) {
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const reachable = Boolean(source.itemId)

  return (
    <li className={`brain-source${source.stale ? ' is-stale' : ''}`}>
      <button
        type="button"
        disabled={!reachable}
        onClick={() => {
          if (!source.itemId) return
          void open(source.itemId)
          void setView('all')
        }}
      >
        <span className="brain-source-head">
          <span className="brain-source-title">{source.title}</span>
          <span className="brain-source-kind">{source.kind}</span>
          {source.quality && <span className="brain-source-quality">{source.quality}</span>}
          {source.stale && <span className="brain-source-flag">stale</span>}
        </span>
        {source.excerpt && <span className="brain-source-excerpt">{source.excerpt}</span>}
        <span className="brain-source-meta">
          {source.uri && (
            <span className="brain-source-uri">
              <FileText size={11} aria-hidden /> {source.uri}
            </span>
          )}
          <span>matched: {source.matchReason}</span>
          <span>{relativeAge(source.updatedAt)}</span>
        </span>
      </button>
    </li>
  )
}

export function BrainAsk() {
  const question = useBrainStore((state) => state.question)
  const setQuestion = useBrainStore((state) => state.setQuestion)
  const ask = useBrainStore((state) => state.ask)
  const asking = useBrainStore((state) => state.asking)
  const answer = useBrainStore((state) => state.answer)
  const asked = useBrainStore((state) => state.asked)
  const reopen = useBrainStore((state) => state.reopen)
  const error = useBrainStore((state) => state.error)
  const clearError = useBrainStore((state) => state.clearError)
  const open = useMemoryStore((state) => state.open)
  const setView = useMemoryStore((state) => state.setView)
  const field = useRef<HTMLInputElement>(null)

  // Arriving on Ask means intending to ask. Landing on a surface whose one control is not focused
  // is the difference between a prompt and a page with a text box on it.
  useEffect(() => {
    field.current?.focus()
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    void ask()
  }

  return (
    <section className="brain-ask" aria-label="Ask Brain">
      <form className="brain-ask-form" onSubmit={submit}>
        <Search size={15} aria-hidden />
        <input
          ref={field}
          type="search"
          value={question}
          placeholder="Ask anything about this project…"
          aria-label="Ask Brain a question about this project"
          onChange={(event) => setQuestion(event.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={asking || !question.trim()}>
          {asking ? 'Thinking…' : 'Ask'}
          {!asking && <CornerDownLeft size={13} aria-hidden />}
        </Button>
      </form>

      {error && (
        <div className="memory-error">
          <ErrorNotice message={error} />
          <Button variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}

      <div className="memory-scroll">
        {!answer && !asking && (
          <div className="brain-ask-empty">
            <p className="memory-empty-lead">
              Brain answers from what this project has actually learned — analysed source, accepted
              knowledge, recorded decisions, and agent results. It does not guess, and it says when
              it holds nothing.
            </p>
            <ul className="brain-openers">
              {OPENERS.map((opener) => (
                <li key={opener}>
                  <button type="button" onClick={() => void ask(opener)}>
                    {opener}
                    <ArrowRight size={12} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {answer && (
          <article className="brain-answer" aria-live="polite">
            <header>
              <h2>{answer.question}</h2>
              <p className="brain-answer-meta">
                <span className="brain-intent">{BRAIN_INTENT_LABELS[answer.intent]}</span>
                {answer.subject && <span>about “{answer.subject}”</span>}
                <span>
                  {answer.considered} record{answer.considered === 1 ? '' : 's'} considered
                </span>
                <span>{answer.elapsedMs} ms</span>
              </p>
            </header>

            {/* Paragraphs, not markdown: the backend composes plain text from stored rows, and
                rendering it as rich text would invite the assumption that a model wrote it. */}
            <div className="brain-answer-body">
              {answer.answer.split('\n\n').map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>

            {/* The honesty line. Brain composes answers deterministically from stored knowledge;
                saying so is what stops this reading as a chatbot that might be inventing. */}
            <p className="brain-synthesis">
              <Sparkles size={11} aria-hidden />
              {answer.synthesis === 'deterministic'
                ? 'Composed from stored project knowledge. No model wrote this text.'
                : `Synthesis: ${answer.synthesis}`}
            </p>

            {answer.sources.length > 0 && (
              <section className="brain-answer-section" aria-label="Sources">
                <h3>
                  <FileText size={13} aria-hidden /> Sources
                  <span className="memory-count tnum">{answer.sources.length}</span>
                </h3>
                <ul className="brain-sources">
                  {answer.sources.map((source) => (
                    <SourceRow key={`${source.kind}-${source.id}`} source={source} />
                  ))}
                </ul>
              </section>
            )}

            {answer.related.length > 0 && (
              <section className="brain-answer-section" aria-label="Related knowledge">
                <h3>
                  <Link2 size={13} aria-hidden /> Related
                  <span className="memory-count tnum">{answer.related.length}</span>
                </h3>
                <ul className="brain-related">
                  {answer.related.map((related) => (
                    <li key={`${related.connection}-${related.itemId}`}>
                      <button
                        type="button"
                        onClick={() => {
                          void open(related.itemId)
                          void setView('all')
                        }}
                      >
                        <span>{related.title}</span>
                        <em>{related.connection.replace('relation:', '')}</em>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {answer.history.length > 0 && (
              <section className="brain-answer-section" aria-label="History">
                <h3>
                  <History size={13} aria-hidden /> History
                  <span className="memory-count tnum">{answer.history.length}</span>
                </h3>
                <ul className="brain-history">
                  {answer.history.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        disabled={!entry.itemId}
                        onClick={() => {
                          if (!entry.itemId) return
                          void open(entry.itemId)
                          void setView('all')
                        }}
                      >
                        <span>{entry.summary}</span>
                        <em>
                          {TIMELINE_LABELS[entry.kind]} · {relativeAge(entry.at)} · {entry.actor}
                        </em>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </article>
        )}

        {/* Questions asked in this session. Not persisted: what someone typed is an event, not
            something the project knows. */}
        {asked.length > 1 && (
          <section className="brain-asked" aria-label="Asked this session">
            <h3>Asked this session</h3>
            <ul>
              {asked
                .filter((prior) => prior.question !== answer?.question)
                .map((prior) => (
                  <li key={prior.question}>
                    <button type="button" onClick={() => reopen(prior)}>
                      <span>{prior.question}</span>
                      <em>
                        {BRAIN_INTENT_LABELS[prior.intent]} · {prior.sources.length} source
                        {prior.sources.length === 1 ? '' : 's'}
                      </em>
                    </button>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  )
}
