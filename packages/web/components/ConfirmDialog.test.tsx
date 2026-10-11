import { render, screen } from '@testing-library/react';
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

  it('does not call onCancel when the backdrop is clicked while isLoading is true', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Eliminando"
        text="Por favor espere..."
        onConfirm={() => {}}
        onCancel={onCancel}
        isLoading={true}
      />
    );

    await userEvent.click(screen.getByLabelText('Confirmación').parentElement as HTMLElement);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('does not call onCancel when Escape is pressed while isLoading is true', async () => {
    const onCancel = jest.fn();
    render(
      <ConfirmDialog
        title="Eliminando"
        text="Por favor espere..."
        onConfirm={() => {}}
        onCancel={onCancel}
        isLoading={true}
      />
    );

    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });
});