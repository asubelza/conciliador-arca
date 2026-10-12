import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';
import { setTheme } from '../lib/theme';

describe('rediseño UI/UX: ThemeToggle', () => {
  afterEach(() => {
    setTheme('light');
    window.localStorage.clear();
  });

  it('starts labeled to switch to dark mode when the theme is light', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Cambiar a modo oscuro' })).toBeInTheDocument();
  });

  it('clicking toggles the theme and the accessible label flips accordingly', async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole('button', { name: 'Cambiar a modo oscuro' }));
    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));
    expect(screen.getByRole('button', { name: 'Cambiar a modo oscuro' })).toBeInTheDocument();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
