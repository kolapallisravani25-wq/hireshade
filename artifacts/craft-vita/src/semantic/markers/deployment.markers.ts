// ---------------------------------------------------------------------------
// deployment.markers.ts
// Deployment and DevOps markers
// ---------------------------------------------------------------------------

import type { SemanticMarker } from "../types/marker.types";

export const DEPLOYMENT_MARKERS: SemanticMarker[] = [
  {
    id: "deploy_deploy",
    phrase: "deploy",
    type: "phrase",
    weight: 0.82,
    category: "deployment",
  },
  {
    id: "deploy_deployment",
    phrase: "deployment",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_ci_cd",
    phrase: "ci cd",
    type: "phrase",
    weight: 0.88,
    category: "deployment",
  },
  {
    id: "deploy_docker",
    phrase: "docker",
    type: "phrase",
    weight: 0.90,
    category: "deployment",
  },
  {
    id: "deploy_kubernetes",
    phrase: "kubernetes",
    type: "phrase",
    weight: 0.92,
    category: "deployment",
  },
  {
    id: "deploy_k8s",
    phrase: "k8s",
    type: "phrase",
    weight: 0.90,
    category: "deployment",
  },
  {
    id: "deploy_helm",
    phrase: "helm",
    type: "phrase",
    weight: 0.88,
    category: "deployment",
  },
  {
    id: "deploy_pipeline",
    phrase: "pipeline",
    type: "phrase",
    weight: 0.82,
    category: "deployment",
  },
  {
    id: "deploy_jenkins",
    phrase: "jenkins",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_github_actions",
    phrase: "github actions",
    type: "phrase",
    weight: 0.88,
    category: "deployment",
  },
  {
    id: "deploy_gitlab",
    phrase: "gitlab",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_aws",
    phrase: "aws",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_azure",
    phrase: "azure",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_gcp",
    phrase: "gcp",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_infrastructure",
    phrase: "infrastructure",
    type: "phrase",
    weight: 0.82,
    category: "deployment",
  },
  {
    id: "deploy_monitoring",
    phrase: "monitoring",
    type: "phrase",
    weight: 0.85,
    category: "deployment",
  },
  {
    id: "deploy_observability",
    phrase: "observability",
    type: "phrase",
    weight: 0.88,
    category: "deployment",
  },
];
