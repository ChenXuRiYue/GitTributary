mod migration;
mod performance;
mod scanning;

use crate::model::GitHubImageConfig;

fn github_config() -> GitHubImageConfig {
    GitHubImageConfig {
        owner: "example".to_string(),
        repository: "images".to_string(),
        branch: "main".to_string(),
        directory: "notes/images".to_string(),
        token: "test-token".to_string(),
    }
}
