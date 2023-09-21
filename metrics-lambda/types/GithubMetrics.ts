class GithubMetrics {
  public commits: number;
  public mergedPRs: number;
  public linesOfCodeWritten: number;
  public repositoriesContributed: number;

  constructor() {
    this.commits = 0;
    this.mergedPRs = 0;
    this.linesOfCodeWritten = 0;
    this.repositoriesContributed = 0;
  }
}

export default GithubMetrics;
