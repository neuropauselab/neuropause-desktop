/**
 * Topics handler (V8.3 inc6). Framework-free wrapper that runs topicClusters over
 * the local memory set (source of truth) and returns display-ready topics. Reuses
 * the verified topicClusters derivation; adds no store.
 */
import type { MemoryItem } from '@neuropause/shared';
import { topicClusters, type TopicCluster, type TopicClustersOptions } from './topicClusters';

export interface TopicsHandlerDeps {
  listItems: () => MemoryItem[];
}

export interface TopicsResult {
  topics: TopicCluster[];
  total: number;
}

export function handleTopics(deps: TopicsHandlerDeps, input: { options?: TopicClustersOptions } = {}): TopicsResult {
  const topics = topicClusters(deps.listItems(), input.options);
  return { topics, total: topics.length };
}
