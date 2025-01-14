import { CartWorkflowDTO } from "@medusajs/types"
import {
  ContainerRegistrationKeys,
  Modules,
  isObject,
  remoteQueryObjectFromString,
} from "@medusajs/utils"
import { StepResponse, createStep } from "@medusajs/workflows-sdk"

export interface RetrieveCartWithLinksStepInput {
  cart_or_cart_id: string | CartWorkflowDTO
  fields: string[]
}

export const retrieveCartWithLinksStepId = "retrieve-cart-with-links"
/**
 * This step retrieves a cart's details with its linked records.
 */
export const retrieveCartWithLinksStep = createStep(
  retrieveCartWithLinksStepId,
  async (data: RetrieveCartWithLinksStepInput, { container }) => {
    const { cart_or_cart_id: cartOrCartId, fields } = data

    if (isObject(cartOrCartId)) {
      return new StepResponse(cartOrCartId)
    }

    const id = cartOrCartId
    const remoteQuery = container.resolve(
      ContainerRegistrationKeys.REMOTE_QUERY
    )
    const query = remoteQueryObjectFromString({
      entryPoint: Modules.CART,
      fields,
    })

    const [cart] = await remoteQuery(query, { cart: { id } })

    return new StepResponse(cart)
  }
)
