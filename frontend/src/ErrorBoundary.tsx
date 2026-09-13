import { Component, type ErrorInfo, type ReactNode } from "react";
import styles from "./App.module.css";
import { ApiError } from "./api";
import { report } from "./reporting";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * The last line of defence. A throw during render otherwise unmounts the entire tree
 * and leaves a blank page, which tells the player nothing and tells us nothing.
 *
 * Placed at the root rather than around individual panels on purpose. A partial
 * boundary can leave a broken game playable in a state that contradicts the server,
 * and reconciling the two is a harder problem than asking for a reload -- the turn
 * state lives in the database, so a refresh genuinely does restore the player.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // componentStack is a path of component names. It carries no props and no state,
    // so it says where the failure happened without carrying anything the player
    // typed -- which is the constraint reporting.ts is built around.
    report("render", error, info.componentStack ?? undefined);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    // The request id is the one part of the failure worth putting on screen: it is
    // the same value the API logged, so a player who quotes it turns a vague
    // complaint into a single server log line.
    const requestId = error instanceof ApiError ? error.requestId : undefined;
    return (
      <div className={styles.page} role="alert">
        <h1>页面出现异常</h1>
        <p className={styles.error}>
          这次操作没有完成，刷新页面即可回到最近的进度。
          {requestId ? `（请求编号 ${requestId}）` : ""}
        </p>
        <button
          type="button"
          className={styles.primary}
          onClick={() => window.location.reload()}
        >
          刷新页面
        </button>
      </div>
    );
  }
}
