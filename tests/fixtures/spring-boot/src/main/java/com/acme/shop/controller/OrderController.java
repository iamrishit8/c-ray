package com.acme.shop.controller;

import com.acme.shop.model.Order;
import com.acme.shop.repository.OrderRepository;
import com.acme.shop.service.OrderService;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {
    private final OrderService orderService;
    private final OrderRepository orderRepository;

    public OrderController(OrderService orderService, OrderRepository orderRepository) {
        this.orderService = orderService;
        this.orderRepository = orderRepository;
    }

    @GetMapping
    public List<Order> list() {
        // Planted layering violation: controller uses the repository directly.
        return orderRepository.findAll();
    }

    @PostMapping
    public Order place(@RequestParam String email, @RequestParam String sku, @RequestParam int quantity) {
        // TODO validate the email address
        return orderService.placeOrder(email, sku, quantity);
    }
}
