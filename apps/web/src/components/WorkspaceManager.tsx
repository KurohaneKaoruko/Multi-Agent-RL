// 智能体工作区管理（环境详情页内）：查看/编辑文件、导入/导出；修改对下一场对局生效
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Typography,
  Upload,
  App as AntdApp,
} from 'antd'
import { DownloadOutlined, EditOutlined, ImportOutlined, SaveOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { EnvironmentConfig } from '@marl/shared'
import { api } from '../api/client'

/** 格式化文件大小 */
function fmtSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export default function WorkspaceManager({
  environmentId,
  env,
}: {
  environmentId: string
  env: EnvironmentConfig
}) {
  const { message } = AntdApp.useApp()
  const queryClient = useQueryClient()
  const isShared = env.workspaceTemplate.mode === 'shared'

  const agentOptions = [
    ...env.agents.map((a) => ({ value: a.id, label: `${a.name}（${a.id}）` })),
    ...(isShared ? [{ value: '_shared', label: '共享工作区（全体成员）' }] : []),
  ]
  const [agentId, setAgentId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null)
  const [dirty, setDirty] = useState(false)

  const filesQuery = useQuery({
    queryKey: ['workspace-files', environmentId, agentId],
    queryFn: () => api.workspaces.files(environmentId, agentId!),
    enabled: agentId != null,
  })
  const files = filesQuery.data?.files ?? []

  const saveMutation = useMutation({
    mutationFn: (input: { path: string; content: string }) =>
      api.workspaces.saveFile(environmentId, agentId!, input.path, input.content),
    onSuccess: () => {
      message.success('已保存（对下一场对局生效）')
      setDirty(false)
      void queryClient.invalidateQueries({ queryKey: ['workspace-files', environmentId, agentId] })
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '保存失败'),
  })
  const importMutation = useMutation({
    mutationFn: (files: Array<{ path: string; content: string }>) =>
      api.workspaces.importFiles(environmentId, agentId!, files),
    onSuccess: (res) => {
      message.success(`已导入 ${res.imported} 个文件`)
      void queryClient.invalidateQueries({ queryKey: ['workspace-files', environmentId, agentId] })
    },
    onError: (err) => message.error(err instanceof Error ? err.message : '导入失败'),
  })

  const openEditor = async (path: string): Promise<void> => {
    const res = await api.workspaces.readFile(environmentId, agentId!, path)
    setEditing({ path, content: res.content })
    setDirty(false)
  }

  const saveEditing = async (): Promise<void> => {
    if (!editing) return
    await saveMutation.mutateAsync({ path: editing.path, content: editing.content })
  }

  const beforeUpload = (file: File): boolean => {
    const reader = new FileReader()
    reader.onload = () => {
      const content = String(reader.result ?? '')
      importMutation.mutate([{ path: file.name, content }])
    }
    reader.readAsText(file)
    return false // 阻止 antd 自动上传，由导入接口统一处理
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          style={{ width: 260 }}
          placeholder="选择智能体"
          value={agentId}
          onChange={(v) => {
            setAgentId(v)
            setEditing(null)
          }}
          options={agentOptions}
        />
        {agentId ? (
          <>
            <Upload multiple beforeUpload={beforeUpload} showUploadList={false} accept=".md,.txt,.json,.csv,.yaml,.yml">
              <Button icon={<ImportOutlined />}>导入文件（文本类）</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} href={api.workspaces.exportUrl(environmentId, agentId)}>
              导出工作区（zip）
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {isShared ? '当前为共享工作区，全体成员可见可写。' : '该工作区仅此智能体可见。'}
              修改对下一场对局生效。
            </Typography.Text>
          </>
        ) : null}
      </Space>

      {!agentId ? (
        <Empty description="请先选择一个智能体以管理其工作区" />
      ) : (
        <Card size="small" className="arlaf-card">
          <Table
            rowKey="path"
            loading={filesQuery.isLoading}
            dataSource={files}
            pagination={false}
            size="small"
            locale={{ emptyText: '工作区暂无文件（智能体对局中生成的文件会在对局结束后出现在这里）' }}
            columns={[
              { title: '文件路径', dataIndex: 'path', ellipsis: true },
              {
                title: '大小',
                dataIndex: 'size',
                width: 110,
                render: (size: number) => fmtSize(size),
              },
              {
                title: '操作',
                width: 120,
                render: (_, record) => (
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => void openEditor(record.path)}
                  >
                    查看 / 编辑
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      <Drawer
        title={
          <Space>
            <EditOutlined />
            {editing?.path}
            {dirty ? <Typography.Text type="warning">（未保存）</Typography.Text> : null}
          </Space>
        }
        open={editing != null}
        onClose={() => setEditing(null)}
        width={720}
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} onClick={() => void saveEditing()}>
            保存
          </Button>
        }
      >
        <Input.TextArea
          value={editing?.content ?? ''}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
          rows={24}
          style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
        />
      </Drawer>
    </div>
  )
}
