# Contributing to Wayfinderr

First off, thanks for taking the time to contribute! It's people like you that make Wayfinderr such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check the issue list as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps which reproduce the problem**
- **Provide specific examples to demonstrate the steps**
- **Describe the behavior you observed after following the steps**
- **Explain which behavior you expected to see instead and why**
- **Include screenshots and animated GIFs if possible**
- **Include your environment details** (OS, Docker version, etc.)

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

- **Use a clear and descriptive title**
- **Provide a step-by-step description of the suggested enhancement**
- **Provide specific examples to demonstrate the steps**
- **Describe the current behavior and the expected behavior**
- **Explain why this enhancement would be useful**

Every proposal becomes an issue first: whoever receives it (the AI assistant included) analyzes it
against the code and the docs and opens an issue with the context, the proposal, what changes, the
acceptance criteria and the open questions. Work starts only when the maintainer gives the go-ahead,
and the pull request closes the issue with `Closes #N`.

### Pull Requests

- Fill in the required template
- Update the documentation and the screenshots the change touches (see [Documentation and screenshots](#documentation-and-screenshots))
- Raise the version (see [Versioning](#versioning))
- Follow the JavaScript/TypeScript styleguides
- End all files with a newline
- Avoid platform-dependent code

## Development Setup

### Prerequisites

- Node.js 20 LTS
- Docker & Docker Compose
- Git

### Local Development

1. Fork and clone the repository
```bash
git clone https://github.com/<your-user>/wayfinderr.git
cd wayfinderr
```

2. Create a feature branch
```bash
git checkout -b feature/your-feature-name
```

3. Set up environment
```bash
cp .env.example .env
```

4. Install dependencies
```bash
# Backend
cd backend
npm install

# Frontend (new terminal)
cd frontend
npm install
```

5. Run development servers
```bash
# Backend
npm run dev

# Frontend (new terminal)
npm run dev
```

### Building & Testing

```bash
# Backend: types and tests
cd backend
npm run typecheck
npm test

# Frontend: types and build
cd frontend
npx tsc --noEmit
npm run build

# Docker images, built from source
docker compose -f docker-compose.yml -f docker-compose.build.yml build
```

More in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Styleguides

### Git Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters or less
- Reference issues and pull requests liberally after the first line

Example:
```
Add Italian media detection for uploads

- Parse audio tracks with ffprobe
- Check for ita language code
- Skip files without Italian content
```

### TypeScript Code Style

- Use strict mode
- Use camelCase for variables and functions
- Use PascalCase for types and classes
- Use UPPER_SNAKE_CASE for constants
- Use meaningful variable names
- Add comments for complex logic
- Use proper error handling

Example:
```typescript
// ✓ Good
const getUserData = async (userId: string): Promise<User> => {
  const response = await api.get(`/users/${userId}`);
  return response.data;
};

// ✗ Bad
const gUD = async (u: any) => {
  return api.get(`/users/${u}`);
};
```

### Frontend Components

- Use functional components with hooks
- Use TypeScript for type safety
- Separate logic from presentation
- Use descriptive prop names
- Document component props

Example:
```typescript
interface ServerCardProps {
  server: Server;
  onEdit: (id: string) => void;
}

export const ServerCard: React.FC<ServerCardProps> = ({ server, onEdit }) => {
  // Component logic
};
```

### Commit Messages

Example structure:
```
[type]: Brief description

Detailed explanation if needed.
- Bullet points for changes
- Keep it concise

Fixes #123
Related to #456
```

Types:
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Test additions/changes
- `chore`: Build process, dependencies, etc.

## Documentation and screenshots

**Every change updates the documentation and the screenshots it touches, in the same pull request.**
A pull request that changes what the user sees, sets or calls is not done until:

- the docs say what the code now does: [README.md](README.md), and in `docs/` the
  [Configuration](docs/CONFIGURATION.md) (with `.env.example` and `docker-compose.yml`) for a
  setting, the [API](docs/API.md) for an endpoint or event, the [User guide](docs/USAGE.md) for a
  feature or a change in behavior, the [Architecture](docs/ARCHITECTURE.md) and its diagrams for a
  new service or module, [Troubleshooting](docs/TROUBLESHOOTING.md) for a problem worth knowing;
- the screenshots are taken again when the UI changed:
  ```bash
  node scripts/screenshots/run.mjs
  ```
  and a new page or dialog gets its shot in `scripts/screenshots/shots.mjs` and its place in the docs
  (look at every PNG before committing it);
- the diagrams in `docs/assets/diagrams` (SVG, never ASCII art) still match the flow;
- [docs/CHANGELOG.md](docs/CHANGELOG.md) has the change.

Every name in the docs, the screenshots and the demo data is made up: no real films, torrents,
release groups or trackers. How the screenshots are made: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#screenshots).

## Versioning

Wayfinderr uses [semantic versioning](https://semver.org). The version lives in
`backend/package.json` and `frontend/package.json` (always the same number) and is
shown in the sidebar, next to the user.

Every pull request to `main` raises the version, never lowers it:

- **patch** (`0.8.0` → `0.8.1`): bug fixes only
- **minor** (`0.8.1` → `0.9.0`): new features or changes in behavior
- **major** (`0.x` → `1.0.0`): only when the maintainer decides

Raise it in both packages with:

```bash
npm version <new-version> --no-git-tag-version --prefix backend
npm version <new-version> --no-git-tag-version --prefix frontend
```

After the merge, tag the release on `main` (`git tag v0.8.1 && git push origin v0.8.1`):
the Docker workflow publishes the images as `0.8.1` and `0.8`.

## Pull Request Process

1. Make sure the work has an issue (every proposal gets one) and say `Closes #N` in the pull request
2. Update the documentation and take the screenshots again (see [Documentation and screenshots](#documentation-and-screenshots))
3. Update `docs/CHANGELOG.md` with notes on your changes
4. Raise the version in both packages
5. Add tests if applicable
6. Ensure all checks pass
7. Request review from maintainers
8. Address feedback and comments

Merged branches are deleted by the **Branch cleanup** workflow (see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#branches)).

## Additional Notes

### Issue and Pull Request Labels

- `bug` - Something isn't working
- `enhancement` - New feature or request
- `documentation` - Improvements or additions to documentation
- `good first issue` - Good for newcomers
- `help wanted` - Extra attention is needed
- `question` - Further information is requested
- `wontfix` - This will not be worked on

## Recognition

Contributors will be recognized in:
- `CHANGELOG.md` under the release they contributed to
- GitHub's contributor graph
- Project README (for significant contributions)

---

**Thank you for contributing to Wayfinderr!** 🎉
