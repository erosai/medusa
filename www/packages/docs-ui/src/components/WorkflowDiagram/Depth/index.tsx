"use client"

import React from "react"
import { WorkflowStepUi } from "types"
import { WorkflowDiagramStepNode } from "../Node"
import { WorkflowDiagramLine } from "../Line"

export type WorkflowDiagramDepthProps = {
  cluster: WorkflowStepUi[]
  next: WorkflowStepUi[]
}

export const WorkflowDiagramDepth = ({
  cluster,
  next,
}: WorkflowDiagramDepthProps) => {
  return (
    <div className="flex items-start">
      <div className="flex flex-col justify-center gap-y-docs_0.5">
        {cluster.map((step) => (
          <WorkflowDiagramStepNode key={step.name} step={step} />
        ))}
      </div>
      <WorkflowDiagramLine step={next} />
    </div>
  )
}
