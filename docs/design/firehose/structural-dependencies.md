# Firehose MVP System Architecture

Status: Draft Date: 2026-07-05 Owner: Rebuilding America Project

## Purpose

This is the structural system diagram for the Firehose MVP. It shows concrete
runtime components, data stores, external dependencies, and product surfaces at
an architecture level. Arrows show the primary dependency or call direction.

Rendered PNG:

![Firehose MVP system architecture](./firehose-structural-dependencies.png)

## Diagram

```mermaid
flowchart TB
  %% Firehose MVP system architecture.

  subgraph External["External dependencies"]
    direction LR
    Users(["Workspace users<br/>newsrooms and civic teams"])
    Clients(["Partner clients<br/>API and MCP"])
    Sources(["Public source providers<br/>feeds, pages, public APIs"])
  end

  subgraph Experience["Client experience layer"]
    direction LR
    WorkspaceUI["Workspace application"]
    ApiClients["API and MCP clients"]
  end

  subgraph Api["API boundary"]
    direction LR
    AuthGateway["Auth and entitlement gateway"]
    FirehoseGateway["Firehose API gateway"]
    SignalQuery["Signal query service"]
    DigestQuery["Digest query service"]
  end

  subgraph Firehose["Firehose runtime"]
    direction LR
    TargetManager["Source target manager"]
    HotWorker["Hot worker"]
    Connectors["Connector runtime"]
    ArtifactPipeline["Artifact normalizer"]
    SignalEngine["Signal engine"]
    Resolver["Entity and context resolver"]
    TrustGate["Trust and safety gate"]
    SignalRouter["Signal router"]
  end

  subgraph AtlasServices["Atlas platform services"]
    direction LR
    CoverageService["Coverage service"]
    CatalogService["Catalog service"]
    WatchService["Watch event service"]
    ReviewService["Review service"]
  end

  subgraph Data["Data stores"]
    direction LR
    FirehoseStore[("Firehose store<br/>targets, artifacts, signals, routes")]
    CoverageStore[("Coverage and watch store")]
    CatalogStore[("Catalog and source store")]
    DigestStore[("Digest event store")]
    ReviewStore[("Review store")]
  end

  subgraph SlowPath["Async enrichment and governance"]
    direction LR
    EnrichmentWorker["Enrichment worker"]
    ReviewWorkflow["Human review workflow"]
    GraphSync["Graph sync service"]
  end

  subgraph Outputs["Product outputs"]
    direction LR
    LiveOutput["Live signal tape"]
    CoverageOutput["Coverage monitoring"]
    DigestOutput["Watch digest"]
    ReviewOutput["Reviewer console"]
    BriefOutput["Briefing Room"]
    ApiOutput["API and MCP output"]
  end

  Users --> WorkspaceUI
  Clients --> ApiClients
  Sources --> Connectors

  WorkspaceUI --> AuthGateway
  ApiClients --> AuthGateway

  AuthGateway --> FirehoseGateway
  FirehoseGateway --> TargetManager
  FirehoseGateway --> SignalQuery
  FirehoseGateway --> DigestQuery

  TargetManager --> FirehoseStore
  TargetManager --> CoverageService
  TargetManager --> HotWorker

  HotWorker --> FirehoseStore
  HotWorker --> Connectors
  Connectors --> ArtifactPipeline
  ArtifactPipeline --> FirehoseStore
  ArtifactPipeline --> SignalEngine

  SignalEngine --> Resolver
  Resolver --> CatalogService
  Resolver --> TrustGate
  TrustGate --> SignalRouter
  SignalRouter --> FirehoseStore
  SignalRouter --> WatchService
  SignalRouter --> ReviewService

  CoverageService --> CoverageStore
  CatalogService --> CatalogStore
  WatchService --> DigestStore
  ReviewService --> ReviewStore

  SignalQuery --> FirehoseStore
  SignalQuery --> CatalogService
  DigestQuery --> WatchService

  FirehoseStore --> EnrichmentWorker
  EnrichmentWorker --> GraphSync
  EnrichmentWorker --> ReviewWorkflow
  ReviewWorkflow --> ReviewService
  GraphSync --> CatalogService

  SignalQuery --> LiveOutput
  SignalQuery --> CoverageOutput
  DigestQuery --> DigestOutput
  ReviewStore --> ReviewOutput
  GraphSync --> BriefOutput
  SignalQuery --> ApiOutput
  CatalogStore --> ApiOutput

  classDef external fill:#eef2ff,stroke:#4f46e5,color:#111827;
  classDef experience fill:#eff6ff,stroke:#2563eb,color:#111827;
  classDef api fill:#ecfeff,stroke:#0891b2,color:#111827;
  classDef firehose fill:#fff7ed,stroke:#ea580c,color:#111827;
  classDef platform fill:#f0fdf4,stroke:#16a34a,color:#111827;
  classDef db fill:#fefce8,stroke:#ca8a04,color:#111827;
  classDef slow fill:#f5f3ff,stroke:#7c3aed,color:#111827;
  classDef output fill:#fdf2f8,stroke:#db2777,color:#111827;

  class Users,Clients,Sources external;
  class WorkspaceUI,ApiClients experience;
  class AuthGateway,FirehoseGateway,SignalQuery,DigestQuery api;
  class TargetManager,HotWorker,Connectors,ArtifactPipeline,SignalEngine,Resolver,TrustGate,SignalRouter firehose;
  class CoverageService,CatalogService,WatchService,ReviewService platform;
  class FirehoseStore,CoverageStore,CatalogStore,DigestStore,ReviewStore db;
  class EnrichmentWorker,ReviewWorkflow,GraphSync slow;
  class LiveOutput,CoverageOutput,DigestOutput,ReviewOutput,BriefOutput,ApiOutput output;
```

## Runtime Dependency Summary

- Workspace users interact with a single workspace application.
- The workspace application exposes live tape, coverage monitoring, digest, and
  briefing experiences.
- All private workspace calls pass through the auth and entitlement gateway.
- Firehose management configures source targets and hot monitoring.
- The hot worker claims due source targets, calls connector runtime, and stores
  immutable artifacts.
- The signal engine classifies artifacts, resolves context, applies the trust
  gate, and sends route decisions to the signal router.
- The signal router writes side effects through existing Atlas platform services
  rather than bypassing catalog, watch, or review rules.
- Data stores are separated by responsibility: Firehose, coverage/watch,
  catalog/source, digest events, and review.
- Async enrichment improves the same stored signals after the hot path has
  already produced the newsroom-grade alert.
- API and MCP consumers read source-backed signals through the same entitlement
  boundary as workspace users.
