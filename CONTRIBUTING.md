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

### Pull Requests

- Fill in the required template
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
git clone https://github.com/yourusername/wayfinderr.git
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
# Build Docker images
docker-compose build

# Run tests
npm run test

# Lint code
npm run lint

# Format code
npm run format
```

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

## Pull Request Process

1. Update documentation if needed
2. Update the `CHANGELOG.md` with notes on your changes
3. Add tests if applicable
4. Ensure all tests pass
5. Request review from maintainers
6. Address feedback and comments

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
