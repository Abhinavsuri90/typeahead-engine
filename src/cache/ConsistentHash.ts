import crypto from 'crypto';
import logger from '../utils/logger';

export class ConsistentHash {
  private ring: Map<number, string> = new Map();
  private sortedKeys: number[] = [];
  private nodes: Set<string> = new Set();
  private replicas: number;

  constructor(replicas: number = 150) {
    this.replicas = replicas;
  }

  private hash(key: string): number {
    const hash = crypto.createHash('md5').update(key).digest('hex');
    return parseInt(hash.substring(0, 8), 16);
  }

  public addNode(node: string): void {
    if (this.nodes.has(node)) return;
    this.nodes.add(node);

    for (let i = 0; i < this.replicas; i++) {
      const vnodeKey = `${node}:vnode${i}`;
      const hashVal = this.hash(vnodeKey);
      this.ring.set(hashVal, node);
      this.sortedKeys.push(hashVal);
    }
    this.sortedKeys.sort((a, b) => a - b);
    
    logger.info({ event: "ring_operation", operation: "addNode", node, vnodeCount: this.sortedKeys.length });
  }

  public removeNode(node: string): void {
    if (!this.nodes.has(node)) return;
    this.nodes.delete(node);

    for (let i = 0; i < this.replicas; i++) {
      const vnodeKey = `${node}:vnode${i}`;
      const hashVal = this.hash(vnodeKey);
      this.ring.delete(hashVal);
    }
    this.sortedKeys = Array.from(this.ring.keys()).sort((a, b) => a - b);
    
    logger.info({ event: "ring_operation", operation: "removeNode", node, vnodeCount: this.sortedKeys.length });
  }

  public getNode(key: string): string | null {
    if (this.sortedKeys.length === 0) return null;

    const hashVal = this.hash(key);
    let left = 0;
    let right = this.sortedKeys.length - 1;
    let targetIdx = 0;

    if (hashVal <= this.sortedKeys[right]) {
      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        if (this.sortedKeys[mid] === hashVal) {
          targetIdx = mid;
          break;
        } else if (this.sortedKeys[mid] < hashVal) {
          left = mid + 1;
        } else {
          targetIdx = mid;
          right = mid - 1;
        }
      }
    }

    const nodeHash = this.sortedKeys[targetIdx];
    return this.ring.get(nodeHash) || null;
  }

  public getRingState(): { nodes: string[], totalVnodes: number, ringPositions: number[] } {
    return {
      nodes: Array.from(this.nodes),
      totalVnodes: this.sortedKeys.length,
      ringPositions: this.sortedKeys
    };
  }
}
