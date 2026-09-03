import type { TabInfo } from '../../../shared/tab-types'

interface TabStripProps {
  tabs: TabInfo[]
  onActivate: (id: number) => void
  onClose: (id: number) => void
  onNewTab: () => void
}

export default function TabStrip({ tabs, onActivate, onClose, onNewTab }: TabStripProps): JSX.Element {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.isActive ? ' tab-active' : ''}`}
          onClick={() => onActivate(tab.id)}
        >
          <span className="tab-title">{tab.isLoading ? 'Loading…' : tab.title}</span>
          <button
            className="tab-close"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="tab-new" aria-label="New tab" onClick={onNewTab}>
        +
      </button>
    </div>
  )
}
