---
id: feature.database
type: feature
name: Database
status: active
generated: true
confidence: 1
evidence_level: verified
created_at: 2026-08-13T19:20:37.121Z
updated_at: 2026-08-19T20:53:17.734Z
sources:
  - file:Paralith-tauri/src/features/database
related:
  - component.ChangeList
  - component.ChangesSection
  - component.ColumnsTab
  - component.COMPACT_NODE_HEIGHT
  - component.ConnectionsSection
  - component.ConstraintsTab
  - component.DatabaseSidebar
  - component.DatabaseStudio
  - component.DefinitionTab
  - component.DiagramSection
  - component.DOMAIN_NODE_WIDTH
  - component.DomainAggregateNode
  - component.EntryRow
  - component.ExplorerSection
  - component.HealthSection
  - component.HealthTab
  - component.HistoryTab
  - component.IndexesTab
  - component.InspectorPanel
  - component.IssueRow
  - component.KindSection
  - component.LARGE_SCHEMA_GROUP_COUNT
  - component.LARGE_SCHEMA_TABLE_COUNT
  - component.LARGE_SCHEMA_VIEWPORT
  - component.LayerUnavailableNotice
  - component.MEDIUM_ROW_CAP
  - component.MigrationsSection
  - component.NEAR_ROW_CAP
  - component.NODE_WIDTH
  - component.OverviewSection
  - ... 63 more
tags:
  - paralith
  - feature
---
<!-- PARALITH:AUTO:START -->

# Database

Feature surface discovered from `Paralith-tauri/src/features/database`.

## Relationships

Outgoing:
- implemented_by -> [[ui - features - database - api]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - canvasSelectors.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - canvasSelectors]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - databaseCanvasStore]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - framing.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - largeSchema.bench.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - largeSchemaFixture]] (verified, 1)
- implemented_by -> [[LARGE_SCHEMA_GROUP_COUNT]] (verified, 1)
- implemented_by -> [[LARGE_SCHEMA_TABLE_COUNT]] (verified, 1)
- implemented_by -> [[LARGE_SCHEMA_VIEWPORT]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - layoutClient]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - layoutCore.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - layoutCore]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - layoutWorker]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - nodeMetrics]] (verified, 1)
- implemented_by -> [[COMPACT_NODE_HEIGHT]] (verified, 1)
- implemented_by -> [[DOMAIN_NODE_WIDTH]] (verified, 1)
- implemented_by -> [[MEDIUM_ROW_CAP]] (verified, 1)
- implemented_by -> [[NEAR_ROW_CAP]] (verified, 1)
- implemented_by -> [[NODE_WIDTH]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - SchemaCanvas.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - SchemaCanvas]] (verified, 1)
- implemented_by -> [[SchemaCanvas]] (verified, 1)
- implemented_by -> [[ui - features - database - components - canvas - TableNode]] (verified, 1)
- implemented_by -> [[DomainAggregateNode]] (verified, 1)
- implemented_by -> [[TableNode]] (verified, 1)
- implemented_by -> [[ui - features - database - components - DatabaseSidebar.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - DatabaseSidebar]] (verified, 1)
- implemented_by -> [[DatabaseSidebar]] (verified, 1)
- implemented_by -> [[SourceUnsupportedBanner]] (verified, 1)
- implemented_by -> [[ui - features - database - components - DatabaseStudio.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - DatabaseStudio]] (verified, 1)
- implemented_by -> [[DatabaseStudio]] (verified, 1)
- implemented_by -> [[ui - features - database - components - InspectorPanel.test]] (verified, 1)
- implemented_by -> [[ui - features - database - components - InspectorPanel]] (verified, 1)
- implemented_by -> [[ColumnsTab]] (verified, 1)
- implemented_by -> [[ConstraintsTab]] (verified, 1)
- implemented_by -> [[DefinitionTab]] (verified, 1)
- implemented_by -> [[HealthTab]] (verified, 1)
- implemented_by -> [[HistoryTab]] (verified, 1)

Incoming:
- [[Project Overview]] -> has_feature (verified, 1)

## Evidence

- `file:Paralith-tauri/src/features/database`

<!-- PARALITH:AUTO:END -->
