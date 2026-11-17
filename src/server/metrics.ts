// In-memory metrics tracking for Firestore operations

let circuitBreakerUntil = 0;

export const firestoreMetrics = {
  setCircuitBreaker(until: number) {
    circuitBreakerUntil = Math.max(circuitBreakerUntil, until);
  },
  isCircuitBreakerActive(): boolean {
    return Date.now() < circuitBreakerUntil;
  },
  recordError(_caller: string, _collection: string, _err: any) {
    // Recorded error
  },
  recordRead(
    _caller: string,
    _collection: string,
    _type: string,
    _count: number,
    _isCache: boolean
  ) {
    // Recorded read operation
  },
  getMetrics() {
    return {
      circuitBreakerActive: this.isCircuitBreakerActive(),
      circuitBreakerUntil,
    };
  },
  reset() {
    circuitBreakerUntil = 0;
  },
};
