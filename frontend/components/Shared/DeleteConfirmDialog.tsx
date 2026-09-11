import React from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from './ConfirmDialog';

interface Props {
    /** Human name of the thing being deleted, e.g. a strategy or record title. */
    itemLabel: string;
    /** Optional extra sentence about side-effects (e.g. "Its Key Results go too."). */
    extra?: string;
    onConfirm: () => void | Promise<void>;
    onCancel: () => void;
}

/**
 * A delete confirmation that always spells out that the action is permanent.
 * Use this for every destructive "delete" action.
 */
const DeleteConfirmDialog: React.FC<Props> = ({
    itemLabel,
    extra,
    onConfirm,
    onCancel,
}) => {
    const { t } = useTranslation();
    return (
        <ConfirmDialog
            title={t('common.deleteTitle', 'Delete {{item}}', {
                item: itemLabel,
            })}
            message={
                t(
                    'common.deleteConfirmIrreversible',
                    'Permanently delete "{{item}}"? This cannot be undone.',
                    { item: itemLabel }
                ) + (extra ? ` ${extra}` : '')
            }
            confirmButtonText={t('common.deletePermanently', 'Delete')}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    );
};

export default DeleteConfirmDialog;
