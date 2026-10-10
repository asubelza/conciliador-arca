import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    // Nothing to clean up - no global state
  });

  it('renders title, text, confirm button, and optional cancel button', () => {
    render(
      <ConfirmDialog
        title="Período eliminado"
        text="¿Estás seguro de que deseas eliminar este período?"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Período eliminado')).toBeInTheDocument();
    expect(screen.getByText('¿Estás seguro de que deseas eliminar este período?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('renders only confirm button when showCancel is not true', () => {
    render(
      <ConfirmDialog
        title="Eliminar"
        text="¿Seguro?"
        onConfirm={() => {}}
        showCancel={false}
      />
    );

    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('triggers onConfirm when confirm button is clicked', async () => {
    const onConfirm = jest.fn();
    render(
      <ConfirmDialog
        title="Confirmar"
        text="¿Continuar?"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('triggers onCancel when cancel button is clicked', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Confirmar"
        text="¿Continuar?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('triggers onCancel when Escape is pressed', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Confirmar"
        text="¿Continuar?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('does not throw when Escape is pressed and onCancel is not provided', async () => {
    render(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} showCancel={false} />
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('triggers onCancel when the backdrop is clicked', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Confirmar"
        text="¿Continuar?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    // The backdrop is the outer element holding the dialog's aria-label target.
    await userEvent.click(screen.getByLabelText('Confirmación').parentElement as HTMLElement);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clicking inside the dialog content does not trigger onCancel', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Confirmar"
        text="¿Continuar?"
        onConfirm={() => {}}
        onCancel={onCancel}
      />
    );

    await userEvent.click(screen.getByText('¿Continuar?'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('uses the shared focus-ring utility plus rounded-lg on both buttons (not the "focus-rounded-lg" typo)', () => {
    render(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} onCancel={() => {}} />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    for (const btn of [confirmBtn, cancelBtn]) {
      expect(btn.className).not.toMatch(/focus-rounded-lg/);
      expect(btn.className).toMatch(/\bfocus-ring\b/);
      expect(btn.className).toMatch(/\brounded-lg\b/);
    }
  });

  it('moves initial focus to the cancel button when the dialog opens', () => {
    render(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} onCancel={() => {}} />
    );

    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('moves initial focus to the confirm button when there is no cancel button', () => {
    render(
      <ConfirmDialog title="Eliminar" text="¿Seguro?" onConfirm={() => {}} showCancel={false} />
    );

    expect(screen.getByRole('button', { name: 'Confirmar' })).toHaveFocus();
  });

  it('traps Tab focus within the dialog, wrapping from the last to the first control and back', async () => {
    render(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} onCancel={() => {}} />
    );

    const cancelBtn = screen.getByRole('button', { name: 'Cancelar' });
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    expect(cancelBtn).toHaveFocus();

    await userEvent.tab();
    expect(confirmBtn).toHaveFocus();

    await userEvent.tab();
    expect(cancelBtn).toHaveFocus();

    await userEvent.tab({ shift: true });
    expect(confirmBtn).toHaveFocus();
  });

  it('keeps focus on the confirm button when it is the only focusable control', async () => {
    render(
      <ConfirmDialog title="Eliminar" text="¿Seguro?" onConfirm={() => {}} showCancel={false} />
    );

    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmBtn).toHaveFocus();

    await userEvent.tab();
    expect(confirmBtn).toHaveFocus();
  });

  it('restores focus to the previously focused element once the dialog closes', async () => {
    function Wrapper() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>Abrir dialogo</button>
          {open && (
            <ConfirmDialog
              title="Confirmar"
              text="¿Continuar?"
              onConfirm={() => {}}
              onCancel={() => setOpen(false)}
            />
          )}
        </div>
      );
    }

    render(<Wrapper />);
    const trigger = screen.getByRole('button', { name: 'Abrir dialogo' });
    trigger.focus();
    await userEvent.click(trigger);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not steal focus back on a re-render that merely passes a new onCancel closure identity (regression: focus-trap effect depended on onCancel)', () => {
    const { rerender } = render(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} onCancel={() => {}} />
    );
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();

    // Simulate the user navigating focus away from the initial target.
    confirmBtn.focus();
    expect(confirmBtn).toHaveFocus();

    // Re-render with a BRAND NEW onCancel closure (identical props
    // otherwise) — e.g. Dashboard's useConfirmAction recreates its `close`
    // callback on every render. This must not re-run the mount/focus-trap
    // effect and re-steal focus back to the cancel button.
    rerender(
      <ConfirmDialog title="Confirmar" text="¿Continuar?" onConfirm={() => {}} onCancel={() => {}} />
    );

    expect(confirmBtn).toHaveFocus();
  });

  it('renders with loading state - confirm button is present, disabled, and has accessible name', () => {
    render(
      <ConfirmDialog
        title="Eliminando"
        text="Por favor espere..."
        onConfirm={() => {}}
        isLoading={true}
      />
    );

    // Confirm button should exist and be disabled
    const confirmBtn = screen.getByRole('button', { name: 'Confirmar' });
    expect(confirmBtn).toBeInTheDocument();
    expect(confirmBtn).toBeDisabled();
  });
});