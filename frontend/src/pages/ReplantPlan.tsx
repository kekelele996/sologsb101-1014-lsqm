/**
 * /replants 补植计划与结构版本
 * 补植计划增删改、状态流转（待补植 → 已补植 → 已复核）、草稿行内编辑、JSON 导入导出。
 * 消费模型：Replant、Survey、全部模型；复用组件：<StatBadge>、<EmptyPanel>、<FilterBar>
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Upload,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  RollbackOutlined,
  SaveOutlined,
  SyncOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import EmptyPanel from '../components/common/EmptyPanel';
import FilterBar from '../components/common/FilterBar';
import StatBadge from '../components/common/StatBadge';
import { useIdbTable } from '../hooks/useIdbTable';
import { usePlotStore } from '../stores/plotStore';
import { useReplantStore } from '../stores/replantStore';
import { DB_NAME, DB_SCHEMA_VERSION, db } from '../utils/db';
import {
  RECONCILIATION_STATUS_LABEL,
  REPLANT_STATE_OPTIONS,
  type Replant,
  type ReplantDraft,
  type ReplantState,
} from '../types/replant';
import type { ReplantCompletion } from '../types/replantCompletion';
import { SEEDLING_SPECIES_OPTIONS, type SeedlingSpecies } from '../types/seedling';
import { exportSnapshotJson, exportSummaryCsvFile, parseSnapshot } from '../utils/export';
import { percentText } from '../utils/rate';

interface ReplantFormValues {
  plotId: string;
  missingCount: number;
  planDate: Dayjs;
  species: SeedlingSpecies;
  state: ReplantState;
}

interface CompletionFormValues {
  actualCount: number;
  completedDate: Dayjs;
  operator: string;
}

export default function ReplantPlan() {
  const { message, modal } = App.useApp();
  const plots = usePlotStore((state) => state.plots);
  const seedlings = usePlotStore((state) => state.seedlings);
  const plantings = usePlotStore((state) => state.plantings);
  const surveys = usePlotStore((state) => state.surveys);
  const statOf = usePlotStore((state) => state.statOf);
  const ready = usePlotStore((state) => state.ready);

  const filters = useReplantStore((state) => state.filters);
  const setFilters = useReplantStore((state) => state.setFilters);
  const resetFilters = useReplantStore((state) => state.resetFilters);
  const drafts = useReplantStore((state) => state.drafts);
  const hasDraft = useReplantStore((state) => state.hasDraft);
  const setDraft = useReplantStore((state) => state.setDraft);
  const clearDraft = useReplantStore((state) => state.clearDraft);
  const saveDraft = useReplantStore((state) => state.saveDraft);
  const createReplant = useReplantStore((state) => state.createReplant);
  const saveReplantEdit = useReplantStore((state) => state.saveReplantEdit);
  const deleteReplant = useReplantStore((state) => state.deleteReplant);
  const completeOnFieldSide = useReplantStore((state) => state.completeOnFieldSide);
  const withdrawCompletion = useReplantStore((state) => state.withdrawCompletion);
  const confirmCompletion = useReplantStore((state) => state.confirmCompletion);
  const batchConfirm = useReplantStore((state) => state.batchConfirm);
  const selectedIds = useReplantStore((state) => state.selectedIds);
  const setSelectedIds = useReplantStore((state) => state.setSelectedIds);
  const exportAll = useReplantStore((state) => state.exportAll);
  const importAll = useReplantStore((state) => state.importAll);
  const resetAll = useReplantStore((state) => state.resetAll);
  const lastMessage = useReplantStore((state) => state.lastMessage);

  const { rows, loading } = useIdbTable<Replant>(db.replants, { sortByUpdatedAt: false });
  const { rows: completionRows } = useIdbTable<ReplantCompletion>(db.replantCompletions, { sortByUpdatedAt: false });
  const [open, setOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [completionTarget, setCompletionTarget] = useState<Replant | null>(null);
  const [editing, setEditing] = useState<Replant | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completionSubmitting, setCompletionSubmitting] = useState(false);
  const form = Form.useForm<ReplantFormValues>()[0];
  const completionForm = Form.useForm<CompletionFormValues>()[0];

  const plotName = (plotId: string): string => plots.find((item) => item.id === plotId)?.name ?? '（地块已删除）';
  const completionOf = (replantId: string): ReplantCompletion | undefined =>
    completionRows.find((item) => item.replantId === replantId);
  const displayStateOf = (row: Replant): ReplantState => {
    if (row.state === '已复核') return '已复核';
    return completionOf(row.id) ? '已补植' : '待补植';
  };

  const filtered = useMemo(() => {
    const key = filters.keyword.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (filters.plotId !== 'all' && row.plotId !== filters.plotId) return false;
        if (filters.state !== 'all' && displayStateOf(row) !== filters.state) return false;
        if (key === '') return true;
        return plotName(row.plotId).toLowerCase().includes(key) || row.species.toLowerCase().includes(key);
      })
      .sort((a, b) => a.planDate.localeCompare(b.planDate));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, completionRows, filters, plots]);

  const stats = useMemo(() => {
    const missing = rows.reduce((acc, row) => acc + row.missingCount, 0);
    const reviewed = rows.filter((row) => row.state === '已复核').length;
    const pending = rows.filter((row) => row.state !== '已复核' && completionOf(row.id) === undefined).length;
    const completed = rows.length - reviewed - pending;
    const held = rows.filter((row) => row.reconciliationStatus === 'hold').length;
    return {
      missing,
      pending,
      completed,
      held,
      reviewed,
      reviewPct: rows.length === 0 ? 0 : Math.round((reviewed / rows.length) * 1000) / 10,
    };
  }, [rows, completionRows]);

  const openCreate = (): void => {
    setEditing(null);
    const plotId = filters.plotId !== 'all' ? filters.plotId : plots.length > 0 ? plots[0].id : '';
    const stat = statOf(plotId);
    form.setFieldsValue({
      plotId,
      missingCount: stat.suggestReplant > 0 ? stat.suggestReplant : 100,
      planDate: dayjs().add(15, 'day'),
      species: seedlings.find((row) => row.plotId === plotId)?.species ?? '秋茄',
      state: '待补植',
    });
    setOpen(true);
  };

  const openEdit = (row: Replant): void => {
    setEditing(row);
    form.setFieldsValue({
      plotId: row.plotId,
      missingCount: row.missingCount,
      planDate: dayjs(row.planDate),
      species: row.species,
      state: row.state,
    });
    setOpen(true);
  };

  const handleSubmit = async (): Promise<void> => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payload: ReplantDraft = {
        plotId: values.plotId,
        missingCount: values.missingCount,
        planDate: values.planDate.format('YYYY-MM-DD'),
        species: values.species,
        state: '待补植',
      };
      if (editing === null) {
        await createReplant(payload);
        message.success(`已创建补植计划：缺株 ${payload.missingCount} 株`);
      } else {
        await saveReplantEdit(editing.id, payload);
        message.success('补植计划已更新');
      }
      setOpen(false);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const openCompletion = (row: Replant): void => {
    const existing = completionOf(row.id);
    setCompletionTarget(row);
    completionForm.setFieldsValue({
      actualCount: existing?.actualCount ?? row.missingCount,
      completedDate: dayjs(existing?.completedDate ?? new Date()),
      operator: existing?.operator ?? '',
    });
    setCompletionOpen(true);
  };

  const handleCompletionSubmit = async (): Promise<void> => {
    if (completionTarget === null) return;
    try {
      const values = await completionForm.validateFields();
      setCompletionSubmitting(true);
      const text = await completeOnFieldSide({
        replantId: completionTarget.id,
        plotId: completionTarget.plotId,
        actualCount: values.actualCount,
        completedDate: values.completedDate.format('YYYY-MM-DD'),
        operator: values.operator.trim(),
      });
      message.success(text);
      setCompletionOpen(false);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    } finally {
      setCompletionSubmitting(false);
    }
  };

  const handleConfirm = async (row: Replant): Promise<void> => {
    try {
      const result = await confirmCompletion(row.id);
      if (result.status === 'hold') message.warning(result.message);
      else message.success(result.message);
    } catch (error) {
      if (error instanceof Error) message.error(error.message);
    }
  };

  const handleExport = async (): Promise<void> => {
    const snapshot = await exportAll();
    const filename = exportSnapshotJson(snapshot);
    message.success(`已导出整库存档 ${filename}`);
  };

  const handleExportCsv = (): void => {
    const filename = exportSummaryCsvFile(plots, seedlings, plantings, surveys, rows);
    message.success(`已导出成活率汇总 ${filename}`);
  };

  const handleImportFile = async (file: File): Promise<void> => {
    const text = await file.text();
    const result = parseSnapshot(text);
    if (!result.ok || result.snapshot === null) {
      message.error(result.message);
      return;
    }
    await importAll(result.snapshot);
    await usePlotStore.getState().refreshCounts();
    message.success(`导入成功：${result.message}`);
  };

  const handleReset = (): void => {
    modal.confirm({
      title: '确认重置本地数据？',
      content: '全部地块、苗木批次、栽植记录、验收记录与补植计划都会被清空，并重新灌入演示数据。',
      okText: '确认重置',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await resetAll();
        await usePlotStore.getState().refreshCounts();
        message.success('已重置为演示数据');
      },
    });
  };

  const columns: ColumnsType<Replant> = [
    {
      title: '地块',
      key: 'plot',
      width: 200,
      render: (_value, record) => (
        <Space direction="vertical" size={0}>
          <span>{plotName(record.plotId)}</span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            最新成活率{' '}
            {statOf(record.plotId).surveyCount > 0 ? percentText(statOf(record.plotId).latestRate) : '未验收'} ·
            栽植 {statOf(record.plotId).plantTotal.toLocaleString('zh-CN')} 株
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '缺株数（株）',
      key: 'missingCount',
      width: 190,
      render: (_value, record) => {
        const draft = drafts[record.id];
        if (draft === undefined) return record.missingCount.toLocaleString('zh-CN');
        return (
          <InputNumber
            min={0}
            max={200000}
            step={10}
            size="small"
            style={{ width: 130 }}
            value={draft.missingCount ?? record.missingCount}
            onChange={(value) => setDraft(record.id, { missingCount: value ?? 0 })}
          />
        );
      },
    },
    {
      title: '计划日期',
      key: 'planDate',
      width: 180,
      render: (_value, record) => {
        const draft = drafts[record.id];
        if (draft === undefined) return record.planDate;
        return (
          <DatePicker
            size="small"
            value={dayjs(draft.planDate ?? record.planDate)}
            onChange={(value) => {
              if (value !== null) setDraft(record.id, { planDate: value.format('YYYY-MM-DD') });
            }}
          />
        );
      },
    },
    {
      title: '补植树种',
      key: 'species',
      width: 150,
      render: (_value, record) => {
        const draft = drafts[record.id];
        if (draft === undefined) return <Tag color="green">{record.species}</Tag>;
        return (
          <Select
            size="small"
            style={{ width: 120 }}
            value={draft.species ?? record.species}
            onChange={(value: SeedlingSpecies) => setDraft(record.id, { species: value })}
            options={SEEDLING_SPECIES_OPTIONS.map((value) => ({ value, label: value }))}
          />
        );
      },
    },
    {
      title: '现场实际补植',
      key: 'completion',
      width: 190,
      render: (_value, record) => {
        const completion = completionOf(record.id);
        if (!completion) return <Typography.Text type="secondary">现场尚未填报</Typography.Text>;
        return (
          <Space direction="vertical" size={0}>
            <span>{completion.actualCount.toLocaleString('zh-CN')} 株</span>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {completion.completedDate} · {completion.operator || '未填班组'}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '状态',
      key: 'state',
      width: 130,
      render: (_value, record) => {
        const display = displayStateOf(record);
        return (
          <Space direction="vertical" size={0}>
            <Tag color={display === '待补植' ? 'orange' : display === '已补植' ? 'blue' : 'green'}>{display}</Tag>
            <Typography.Text
              type={record.reconciliationStatus === 'hold' ? 'danger' : 'secondary'}
              style={{ fontSize: 12 }}
            >
              {RECONCILIATION_STATUS_LABEL[record.reconciliationStatus]}
            </Typography.Text>
          </Space>
        );
      },
    },
    {
      title: '核对说明',
      dataIndex: 'holdReason',
      key: 'holdReason',
      width: 220,
      render: (value: string) =>
        value ? (
          <Typography.Text type="danger" style={{ fontSize: 12 }}>
            {value}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            —
          </Typography.Text>
        ),
    },
    {
      title: '草稿',
      key: 'draft',
      width: 150,
      render: (_value, record) =>
        hasDraft(record.id) ? (
          <Space size={4}>
            <Button
              size="small"
              type="primary"
              icon={<SaveOutlined />}
              onClick={() => void saveDraft(record.id)}
            >
              保存
            </Button>
            <Button size="small" onClick={() => clearDraft(record.id)}>
              放弃
            </Button>
          </Space>
        ) : (
          <Button
            size="small"
            onClick={() =>
              setDraft(record.id, {
                missingCount: record.missingCount,
                planDate: record.planDate,
                species: record.species,
                state: record.state,
              })
            }
          >
            改草稿
          </Button>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 330,
      fixed: 'right',
      render: (_value, record) => {
        const completion = completionOf(record.id);
        return (
          <Space size={4} wrap>
            {record.state !== '已复核' && !completion ? (
              <Button
                size="small"
                type="link"
                icon={<CheckCircleOutlined />}
                onClick={() => openCompletion(record)}
              >
                现场填报完成
              </Button>
            ) : null}
            {record.state !== '已复核' && completion ? (
              <>
                <Button size="small" type="link" icon={<SyncOutlined />} onClick={() => openCompletion(record)}>
                  修改现场记录
                </Button>
                <Button size="small" type="link" icon={<CheckCircleOutlined />} onClick={() => void handleConfirm(record)}>
                  验收组确认
                </Button>
                <Popconfirm
                  title="确认撤回现场补植完成记录？"
                  okText="撤回"
                  cancelText="取消"
                  onConfirm={async () => {
                    const text = await withdrawCompletion(record.id);
                    message.success(text);
                  }}
                >
                  <Button size="small" type="link" danger icon={<RollbackOutlined />}>
                    撤回
                  </Button>
                </Popconfirm>
              </>
            ) : null}
            <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(record)} disabled={completion !== undefined}>
              编辑
            </Button>
            <Popconfirm
              title={completion ? '现场班组已提交完成记录，验收组不能删除' : '确认删除该补植计划？'}
              okText="删除"
              okButtonProps={{ danger: true, disabled: completion !== undefined }}
              cancelText="取消"
              onConfirm={async () => {
                if (completion) return;
                await deleteReplant(record.id);
                message.success('补植计划已删除');
              }}
            >
              <Button size="small" type="link" danger icon={<DeleteOutlined />} disabled={completion !== undefined}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <StatBadge label="补植计划" value={rows.length} suffix="条" tone="primary" />
        <StatBadge label="待补植" value={stats.pending} suffix="条" tone={stats.pending > 0 ? 'warning' : 'default'} />
        <StatBadge label="现场已补植" value={stats.completed} suffix="条" tone="info" />
        <StatBadge label="挂起核对" value={stats.held} suffix="条" tone={stats.held > 0 ? 'danger' : 'default'} />
        <StatBadge label="缺株合计" value={stats.missing.toLocaleString('zh-CN')} suffix="株" tone="danger" />
        <StatBadge
          label="复核完成率"
          value={percentText(stats.reviewPct)}
          percent={stats.reviewPct}
          tone="success"
          hint="状态为「已复核」的计划占比"
        />
        <StatBadge
          label="数据结构版本"
          value={`v${DB_SCHEMA_VERSION}`}
          suffix={`· ${DB_NAME}`}
          tone="info"
          hint="IndexedDB 库名与结构版本号；升级时会按 version().stores() 自动迁移"
        />
      </div>

      {lastMessage !== '' ? (
        <Alert type="info" showIcon style={{ marginBottom: 14 }} message={lastMessage} />
      ) : null}

      <Card
        title="补植计划与结构版本"
        extra={
          <Space wrap>
            <Button icon={<DownloadOutlined />} onClick={() => void handleExport()}>
              导出 JSON 存档
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExportCsv}>
              导出 CSV 汇总
            </Button>
            <Upload
              accept=".json"
              showUploadList={false}
              beforeUpload={(file) => {
                void handleImportFile(file as unknown as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />}>导入 JSON 存档</Button>
            </Upload>
            <Button danger icon={<ClearOutlined />} onClick={handleReset}>
              重置演示数据
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} disabled={plots.length === 0}>
              新建补植计划
            </Button>
          </Space>
        }
      >
        <FilterBar
          keyword={filters.keyword}
          onKeywordChange={(value: string) => setFilters({ keyword: value })}
          fields={[
            { key: 'plotId', label: '地块', options: plots.map((plot) => plot.id), optionLabels: Object.fromEntries(plots.map((plot) => [plot.id, plot.name])) },
            { key: 'state', label: '状态', options: [...REPLANT_STATE_OPTIONS] },
          ]}
          values={{ plotId: filters.plotId, state: filters.state }}
          onChange={(key: string, value: string) => {
            if (key === 'plotId') setFilters({ plotId: value });
            if (key === 'state') setFilters({ state: value as ReplantState | 'all' });
          }}
          onReset={resetFilters}
          resultText={`命中 ${filtered.length} / ${rows.length} 条`}
          extra={
            <>
              <Tag color={selectedIds.length > 0 ? 'purple' : 'default'}>已选 {selectedIds.length} 条</Tag>
              <Button
                icon={<CheckCircleOutlined />}
                disabled={selectedIds.length === 0}
                onClick={async () => {
                  const result = await batchConfirm();
                  message.success(`验收组批量确认完成：${result.confirmed} 条通过，${result.held} 条挂起`);
                }}
              >
                批量验收确认
              </Button>
            </>
          }
        />

        {rows.length === 0 && !loading ? (
          <EmptyPanel
            title="还没有补植计划"
            description="验收成活率偏低时可一键生成补植计划；也可以在这里手动新建，并按「待补植 → 已补植 → 已复核」推进。"
            actionText="新建补植计划"
            onAction={openCreate}
          />
        ) : (
          <Table<Replant>
            rowKey="id"
            size="middle"
            loading={loading || !ready}
            columns={columns}
            dataSource={filtered}
            scroll={{ x: 1680 }}
            rowSelection={{
              selectedRowKeys: selectedIds,
              onChange: (keys) => setSelectedIds(keys.map((key) => String(key))),
            }}
            pagination={{ pageSize: 8, showSizeChanger: false }}
            locale={{
              emptyText: <EmptyPanel title="没有符合筛选条件的补植计划" actionText="重置筛选" onAction={resetFilters} />,
            }}
          />
        )}
      </Card>

      <Modal
        title={editing === null ? '新建补植计划' : '编辑补植计划'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="plotId" label="地块" rules={[{ required: true, message: '请选择地块' }]}>
            <Select options={plots.map((plot) => ({ value: plot.id, label: plot.name }))} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="missingCount"
              label="缺株数（株）"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请填写缺株数' }]}
            >
              <InputNumber min={1} max={200000} step={10} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="planDate" label="计划日期" style={{ flex: 1 }} rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="species" label="补植树种" rules={[{ required: true }]}>
            <Select options={SEEDLING_SPECIES_OPTIONS.map((value) => ({ value, label: value }))} />
          </Form.Item>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            补植计划由项目部验收组维护；现场班组只填写实际补植株数和完成日期，验收组确认后才重算成活率。
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title="现场班组填报补植完成"
        open={completionOpen}
        onCancel={() => setCompletionOpen(false)}
        onOk={() => void handleCompletionSubmit()}
        confirmLoading={completionSubmitting}
        okText="保存现场记录"
        cancelText="取消"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="本记录只保存在现场班组侧"
          description="保存后不会改写验收测次；项目部验收组核对并确认后，才会重算成活率。"
        />
        <Form form={completionForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item
              name="actualCount"
              label="实际补植株数"
              style={{ flex: 1 }}
              rules={[{ required: true, message: '请填写实际补植株数' }]}
            >
              <InputNumber min={1} max={200000} step={10} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="completedDate" label="实际完成日期" style={{ flex: 1 }} rules={[{ required: true }]}>
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="operator" label="现场班组" rules={[{ required: true, message: '请填写现场班组' }]}>
            <Input placeholder="如：西湾补植班" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
