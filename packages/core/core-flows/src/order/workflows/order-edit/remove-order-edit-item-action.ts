import {
  OrderChangeActionDTO,
  OrderChangeDTO,
  OrderDTO,
  OrderWorkflow,
} from "@medusajs/types"
import { ChangeActionType, OrderChangeStatus } from "@medusajs/utils"
import {
  WorkflowData,
  WorkflowResponse,
  createStep,
  createWorkflow,
} from "@medusajs/workflows-sdk"
import { useRemoteQueryStep } from "../../../common"
import {
  deleteOrderChangeActionsStep,
  previewOrderChangeStep,
} from "../../steps"
import {
  throwIfIsCancelled,
  throwIfOrderChangeIsNotActive,
} from "../../utils/order-validation"

/**
 * This step validates that a new item can be removed from an order edit.
 */
export const removeOrderEditItemActionValidationStep = createStep(
  "remove-item-order-edit-action-validation",
  async function ({
    order,
    orderChange,
    input,
  }: {
    order: OrderDTO
    orderChange: OrderChangeDTO
    input: OrderWorkflow.DeleteOrderEditItemActionWorkflowInput
  }) {
    throwIfIsCancelled(order, "Order")
    throwIfOrderChangeIsNotActive({ orderChange })

    const associatedAction = (orderChange.actions ?? []).find(
      (a) => a.id === input.action_id
    ) as OrderChangeActionDTO

    if (!associatedAction) {
      throw new Error(
        `No item found for order ${input.order_id} in order change ${orderChange.id}`
      )
    } else if (associatedAction.action !== ChangeActionType.ITEM_ADD) {
      throw new Error(`Action ${associatedAction.id} is not adding an item`)
    }
  }
)

export const removeItemOrderEditActionWorkflowId =
  "remove-item-order edit-action"
/**
 * This workflow removes a new item in an order edit.
 */
export const removeItemOrderEditActionWorkflow = createWorkflow(
  removeItemOrderEditActionWorkflowId,
  function (
    input: WorkflowData<OrderWorkflow.DeleteOrderEditItemActionWorkflowInput>
  ): WorkflowResponse<OrderDTO> {
    const order: OrderDTO = useRemoteQueryStep({
      entry_point: "orders",
      fields: ["id", "status", "canceled_at", "items.*"],
      variables: { id: input.order_id },
      list: false,
      throw_if_key_not_found: true,
    }).config({ name: "order-query" })

    const orderChange: OrderChangeDTO = useRemoteQueryStep({
      entry_point: "order_change",
      fields: ["id", "status", "version", "actions.*"],
      variables: {
        filters: {
          order_id: input.order_id,
          status: [OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED],
        },
      },
      list: false,
    }).config({ name: "order-change-query" })

    removeOrderEditItemActionValidationStep({
      order,
      input,
      orderChange,
    })

    deleteOrderChangeActionsStep({ ids: [input.action_id] })

    return new WorkflowResponse(previewOrderChangeStep(order.id))
  }
)
