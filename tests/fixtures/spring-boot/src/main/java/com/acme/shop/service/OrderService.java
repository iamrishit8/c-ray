package com.acme.shop.service;

import com.acme.shop.client.InventoryClient;
import com.acme.shop.messaging.OrderEventPublisher;
import com.acme.shop.model.Order;
import com.acme.shop.model.OrderItem;
import com.acme.shop.model.Product;
import com.acme.shop.repository.OrderRepository;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository orderRepository;
    private final ProductService productService;
    private final InventoryClient inventoryClient;
    private final OrderEventPublisher publisher;

    public OrderService(OrderRepository orderRepository, ProductService productService,
                        InventoryClient inventoryClient, OrderEventPublisher publisher) {
        this.orderRepository = orderRepository;
        this.productService = productService;
        this.inventoryClient = inventoryClient;
        this.publisher = publisher;
    }

    public long countPending() {
        return orderRepository.findByStatus("PENDING").size();
    }

    public Order placeOrder(String email, String sku, int quantity) {
        if (!inventoryClient.isAvailable(sku, quantity)) {
            throw new IllegalStateException("not available");
        }
        Product product = productService.reserve(sku, quantity);
        Order order = new Order();
        order.setCustomerEmail(email);
        order.setStatus("PENDING");
        OrderItem item = new OrderItem();
        item.setOrder(order);
        item.setProduct(product);
        item.setQuantity(quantity);
        order.getItems().add(item);
        Order saved = orderRepository.save(order);
        publisher.orderPlaced(saved);
        return saved;
    }

    public String describe(List<Product> products) {
        StringBuilder builder = new StringBuilder();
        int index = 0;
        for (Product product : products) {
            if (index > 0) {
                builder.append(", ");
            }
            builder.append(product.getSku());
            builder.append(" x");
            builder.append(product.getStock());
            index++;
        }
        builder.append(" (");
        builder.append(index);
        builder.append(" total)");
        return builder.toString();
    }
}
